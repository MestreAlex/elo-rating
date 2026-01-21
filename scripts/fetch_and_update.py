"""
Fetch latest league CSVs from football-data.co.uk and regenerate matches and ratings.
This version saves a compressed timestamped backup of each downloaded CSV to data/backups/.

Downloads the provided list of URLs into the local data/ folder with filenames like E0_2526.csv
Then calls the existing generator script `scripts/generate_matches_and_ratings.py` using the
same Python interpreter.

This script is safe to run manually and is suitable to be scheduled (Task Scheduler / cron).
"""
import os
import sys
import urllib.request
import urllib.error
from urllib.parse import urlsplit
import time
import subprocess
import gzip
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
LOG_FILE = os.path.join(ROOT, 'scripts', 'fetch_and_update.log')

URLS = [
    'https://www.football-data.co.uk/mmz4281/2526/E0.csv',
    'https://www.football-data.co.uk/mmz4281/2526/E1.csv',
    'https://www.football-data.co.uk/mmz4281/2526/D1.csv',
    'https://www.football-data.co.uk/mmz4281/2526/D2.csv',
    'https://www.football-data.co.uk/mmz4281/2526/I1.csv',
    'https://www.football-data.co.uk/mmz4281/2526/I2.csv',
    'https://www.football-data.co.uk/mmz4281/2526/F1.csv',
    'https://www.football-data.co.uk/mmz4281/2526/F2.csv',
    'https://www.football-data.co.uk/mmz4281/2526/SP1.csv',
    'https://www.football-data.co.uk/mmz4281/2526/SP2.csv'
]

# ensure data and backup dirs exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)


def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f'[{ts}] {msg}\n')
    print(msg)


def local_filename_for_url(url):
    p = urlsplit(url).path
    parts = [p for p in p.split('/') if p]
    if len(parts) >= 2:
        season = parts[-2]
        fname = parts[-1]
    else:
        season = ''
        fname = parts[-1]
    base = os.path.splitext(fname)[0]
    # standardized local name: <base>_<season>.csv e.g. E0_2526.csv
    local = f"{base}_{season}.csv" if season else fname
    return os.path.join(DATA_DIR, local)


def download_url(url, dest):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'elo-fetcher/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            with open(dest, 'wb') as f:
                f.write(data)
        return True, None
    except urllib.error.HTTPError as e:
        return False, f'HTTP {e.code} {e.reason}'
    except Exception as e:
        return False, str(e)


def backup_file(src):
    try:
        bname = os.path.basename(src)
        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        gzname = f"{bname}.{ts}.gz"
        gzpath = os.path.join(BACKUP_DIR, gzname)
        with open(src, 'rb') as f_in, gzip.open(gzpath, 'wb') as f_out:
            f_out.writelines(f_in)
        return gzpath
    except Exception as e:
        return None


def main():
    log('Starting fetch_and_update')
    downloaded = []
    for url in URLS:
        dest = local_filename_for_url(url)
        log(f'Downloading {url} -> {dest}')
        ok, err = download_url(url, dest)
        if ok:
            log(f'  OK')
            downloaded.append(dest)
            gz = backup_file(dest)
            if gz:
                log(f'  Backup created: {gz}')
            else:
                log(f'  Backup failed for: {dest}')
        else:
            log(f'  ERROR: {err}')

    # run generator
    gen_script = os.path.join(ROOT, 'scripts', 'generate_matches_and_ratings.py')
    if os.path.exists(gen_script):
        log(f'Running generator: {gen_script}')
        try:
            # use same python interpreter
            res = subprocess.run([sys.executable, gen_script], cwd=ROOT, capture_output=True, text=True, timeout=900)
            log('Generator stdout:')
            for line in res.stdout.splitlines():
                log('  ' + line)
            log('Generator stderr:')
            for line in res.stderr.splitlines():
                log('  ' + line)
            log(f'Generator exit code: {res.returncode}')
        except Exception as e:
            log('Failed to run generator: ' + str(e))
    else:
        log('Generator script not found: ' + gen_script)

    log('fetch_and_update finished')

if __name__ == '__main__':
    main()
