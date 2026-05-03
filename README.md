# imdb-list-creator

Automate the creation of [IMDB](https://www.imdb.com) lists from a CSV file. Point it at a CSV of titles grouped by category, and it creates one IMDB list per category, populated via IMDB's autocomplete (year-aware so you don't get the wrong "Planet Earth").

Resumable — if it crashes mid-way, just re-run and it picks up where it left off.

## What it does

1. Reads a CSV of `Title,Year,Category` rows
2. Groups them by category
3. Opens a Chromium window so you can sign into IMDB once (saved for future runs)
4. Creates one IMDB list per category (default name: `My {category} Picks`)
5. Adds each title via IMDB's search autocomplete, picking the right entry by year
6. Saves progress to `imdb-lists.json` after every single item — fully resumable

## Requirements

- Node.js 18+
- An IMDB account
- ~100 MB free disk space (Chromium binary)

## Setup

```bash
git clone https://github.com/Kerollosl/imdb-list-creator.git
cd imdb-list-creator
npm install            # also installs a local Chromium via Playwright
```

## Usage

1. **Prepare your CSV.** Copy the example and edit:
   ```bash
   cp imdb.csv.example imdb.csv
   # ...edit imdb.csv with your titles, years, categories...
   ```

   Format:
   ```
   Title,Year,Category
   The Shawshank Redemption,1994,Drama
   The Dark Knight,2008,Action
   ```

2. **Run it:**
   ```bash
   npm start
   # or:
   node create-imdb-lists.mjs path/to/your.csv
   ```

3. **First run only:** A Chromium window opens. Sign in to IMDB manually. The script polls every 4 seconds and continues automatically once you're signed in. Login state is saved in `.imdb-user-data/` (gitignored) for re-runs.

4. **Watch it work.** It logs progress like:
   ```
   === Creating list: Documentary (12 items) ===
       list URL: https://www.imdb.com/list/ls4176291325
       + Planet Earth II (2016) -> Planet Earth II (2016)
       + Planet Earth (2006) -> Planet Earth (2006)
   ```

## Output

Results land in `imdb-lists.json`:

```json
{
  "Documentary": {
    "url": "https://www.imdb.com/list/ls4176291325",
    "items": [
      { "title": "Planet Earth II", "year": "2016", "status": "added", "matched": "Planet Earth II (2016)" },
      ...
    ]
  }
}
```

## Customizing the list name

By default lists are named `My {Category} Picks`. To change the pattern, set an env var:

```bash
IMDB_LIST_NAME_PATTERN="{category} — Personal Picks" npm start
# Creates lists named "Drama — Personal Picks", "Action — Personal Picks", etc.
```

The token `{category}` is replaced with the category name from your CSV.

## Resumability

If the script crashes, is interrupted, or you stop it mid-run:
- Already-created lists are reused (won't create duplicates)
- Already-added titles are skipped (compared by `title|year`)
- Failed items are logged with their error and can be retried

Just re-run `npm start` — it picks up exactly where it left off.

## Tips

- IMDB has rate limits. The script waits 1.5s between items and 4s between lists. Don't reduce these aggressively or you'll hit captchas.
- Year is critical for disambiguation — without it, "Planet Earth" might match either the 2006 or 2016 series.
- If a title can't be found, check that the year matches IMDB's listing (some shows have multiple year ranges).

## Why?

Building IMDB lists by hand is tedious — clicking into each title, scrolling search results, finding the right entry. This automates the whole flow from a structured CSV.

## License

MIT — do whatever you want with it. Sign-in is yours, the lists are yours.
