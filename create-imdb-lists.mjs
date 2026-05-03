// Creates one IMDB list per category from a CSV of titles.
//
// Usage:
//   node create-imdb-lists.mjs [path/to/imdb.csv]
//
// The first run opens a real Chromium window so you can sign into IMDB.
// The login is saved in ./.imdb-user-data and reused on subsequent runs.
//
// Output: imdb-lists.json with the URL of each created list and per-item status.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(process.argv[2] || path.join(__dirname, 'imdb.csv'));
const USER_DATA_DIR = path.join(__dirname, '.imdb-user-data');
const OUTPUT_PATH = path.join(__dirname, 'imdb-lists.json');

const NAV_TIMEOUT = 45_000;
const ACTION_TIMEOUT = 20_000;
const PER_ITEM_DELAY_MS = 1500;
const PER_LIST_DELAY_MS = 4000;

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') {
                out.push(cur);
                cur = '';
            } else cur += c;
        }
    }
    out.push(cur);
    return out;
}

function parseCsv(content) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < 3) continue;
        // CSV has duplicate columns: the last three are the clean ones.
        const [title, year, category] = fields.slice(-3).map((s) => s.trim());
        if (!title || !category) continue;
        rows.push({ title, year, category });
    }
    return rows;
}

function groupByCategory(rows) {
    const out = new Map();
    for (const r of rows) {
        if (!out.has(r.category)) out.set(r.category, []);
        out.get(r.category).push(r);
    }
    return out;
}

async function probeSignedIn(ctx) {
    // Open a throwaway page to probe state without disturbing the user's tab.
    // /list/create is gated: signed-in users see the form, signed-out users
    // are redirected to /registration/signin.
    const probe = await ctx.newPage();
    try {
        await probe.goto('https://www.imdb.com/list/create', {
            waitUntil: 'domcontentloaded',
            timeout: NAV_TIMEOUT,
        });
        const url = probe.url();
        if (/registration\/(signin|ap\/signin)|amazon\.com\/ap\/signin/i.test(url)) return false;
        if (/\/list\/create/i.test(url)) return true;
        // Fallback: look for the create-list form input.
        const hasForm = await probe
            .locator('input[name="list_name"], input#list_name')
            .first()
            .isVisible()
            .catch(() => false);
        return hasForm;
    } finally {
        await probe.close().catch(() => {});
    }
}

async function ensureSignedIn(ctx, page) {
    if (await probeSignedIn(ctx)) {
        console.log('Already signed in. Proceeding.');
        return;
    }

    await page
        .goto('https://www.imdb.com/registration/signin', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
        .catch(() => {});
    console.log('\n>>> Not signed in. A Chromium window is open — please sign in to IMDB now.');
    console.log('    The script will detect the login automatically and proceed (15 min timeout).');

    const start = Date.now();
    const timeout = 15 * 60 * 1000;
    while (Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
            if (await probeSignedIn(ctx)) {
                console.log('Sign-in detected. Continuing.');
                return;
            }
        } catch {
            /* transient; ignore */
        }
    }
    throw new Error('Timed out waiting for IMDB sign-in.');
}

async function createList(page, name, description) {
    await page.goto('https://www.imdb.com/list/create', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    const nameField = page.locator('input[data-testid="input-list-name"]').first();
    await nameField.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
    await nameField.fill(name);

    const descField = page.locator('textarea[data-testid="input-list-description"]').first();
    if (await descField.isVisible().catch(() => false)) {
        await descField.fill(description);
    }

    // Ensure list type = TITLES (default, but click defensively).
    const titlesRadio = page.locator('input[data-testid="input-list-type-TITLES"]').first();
    if (await titlesRadio.isVisible().catch(() => false)) {
        await titlesRadio.check({ force: true }).catch(() => {});
    }

    const submit = page.locator('button[data-testid="list-create-button"]').first();
    await submit.click();
    await page.waitForURL(/\/list\/ls\d+/, { timeout: NAV_TIMEOUT });
    // Returns the canonical /list/ls<id> URL (strips /edit, query, trailing slash).
    return page.url().split('?')[0].replace(/\/$/, '').replace(/\/edit$/, '');
}

async function ensureOnEditPage(page, listUrl) {
    const target = `${listUrl}/edit`;
    if (!page.url().startsWith(target)) {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        // Wait for the autocomplete input to be ready.
        await page
            .locator('input[data-testid="entity-autocomplete-input"]')
            .first()
            .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
    }
}

async function addTitleToList(page, listUrl, { title, year }) {
    await ensureOnEditPage(page, listUrl);

    const input = page.locator('input[data-testid="entity-autocomplete-input"]').first();
    await input.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
    await input.click();
    await input.fill('');
    // Type via real keystrokes so react-autosuggest fires.
    await input.pressSequentially(title, { delay: 50 });

    const list = page.locator('ul.react-autosuggest__suggestions-list');
    try {
        await list.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
        throw new Error('no suggestions appeared');
    }
    // Let the dropdown settle.
    await page.waitForTimeout(400);

    const options = page.locator('li.react-autosuggest__suggestion');
    const count = await options.count();
    if (count === 0) throw new Error('no suggestion options');

    const titleLower = title.toLowerCase();
    let chosen = -1;
    if (year) {
        let yearMatchIdx = -1;
        for (let i = 0; i < count; i++) {
            const text = ((await options.nth(i).innerText()) || '').trim();
            const tLower = text.toLowerCase();
            const yearOk = text.includes(`(${year})`);
            const startsOk = tLower.startsWith(titleLower);
            if (yearOk && startsOk) {
                chosen = i;
                break;
            }
            if (yearOk && yearMatchIdx === -1) yearMatchIdx = i;
        }
        if (chosen === -1) chosen = yearMatchIdx;
    }
    if (chosen === -1) {
        // Fall back to first suggestion whose title text starts with the query.
        for (let i = 0; i < count; i++) {
            const t = ((await options.nth(i).innerText()) || '').trim().toLowerCase();
            if (t.startsWith(titleLower)) {
                chosen = i;
                break;
            }
        }
    }
    if (chosen === -1) chosen = 0;

    const chosenText = ((await options.nth(chosen).innerText()) || '').trim();
    await options.nth(chosen).click();
    // Allow the add request to complete; the dropdown closes after a successful add.
    await page.waitForTimeout(900);
    return chosenText;
}

async function main() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`CSV not found at ${CSV_PATH}`);
        process.exit(1);
    }

    const csv = fs.readFileSync(CSV_PATH, 'utf8');
    const rows = parseCsv(csv);
    const grouped = groupByCategory(rows);

    console.log(`Loaded ${rows.length} titles across ${grouped.size} categories:`);
    for (const [cat, items] of grouped) console.log(`  ${cat}: ${items.length}`);

    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
    });
    ctx.setDefaultTimeout(ACTION_TIMEOUT);
    ctx.setDefaultNavigationTimeout(NAV_TIMEOUT);
    const page = ctx.pages()[0] || (await ctx.newPage());

    await ensureSignedIn(ctx, page);

    const previous = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) : {};
    const results = previous;

    for (const [category, items] of grouped) {
        const existing = results[category];
        let listUrl = existing?.url;

        if (!listUrl) {
            console.log(`\n=== Creating list: ${category} (${items.length} items) ===`);
            const listNamePattern = process.env.IMDB_LIST_NAME_PATTERN || 'My {category} Picks';
            const listName = listNamePattern.replace(/\{category\}/g, category);
            try {
                listUrl = await createList(
                    page,
                    listName,
                    `Auto-generated list for the ${category} category.`
                );
                console.log(`    list URL: ${listUrl}`);
            } catch (err) {
                console.warn(`    ! Failed to create list for ${category}:`, err.message);
                results[category] = { url: null, error: err.message, items: items.map((i) => ({ ...i, status: 'skipped' })) };
                fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
                continue;
            }
            results[category] = { url: listUrl, items: [] };
        } else {
            console.log(`\n=== Resuming list: ${category} -> ${listUrl} ===`);
            results[category].items = results[category].items || [];
        }

        const alreadyAdded = new Set(
            (results[category].items || []).filter((i) => i.status === 'added').map((i) => `${i.title}|${i.year}`)
        );

        for (const item of items) {
            const key = `${item.title}|${item.year}`;
            if (alreadyAdded.has(key)) {
                console.log(`    = ${item.title} (${item.year}) [already added]`);
                continue;
            }
            try {
                const matchedText = await addTitleToList(page, listUrl, item);
                results[category].items.push({ ...item, status: 'added', matched: matchedText });
                console.log(`    + ${item.title} (${item.year}) -> ${matchedText}`);
            } catch (err) {
                results[category].items.push({ ...item, status: 'failed', error: err.message });
                console.warn(`    ! ${item.title} (${item.year}): ${err.message}`);
            }
            fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
            await page.waitForTimeout(PER_ITEM_DELAY_MS);
        }

        await page.waitForTimeout(PER_LIST_DELAY_MS);
    }

    console.log(`\nDone. Results saved to ${OUTPUT_PATH}`);
    console.log('Created lists:');
    for (const [cat, res] of Object.entries(results)) {
        if (res.url) console.log(`  ${cat}: ${res.url}`);
    }

    await ctx.close();
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
