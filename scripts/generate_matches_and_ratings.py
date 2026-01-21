#!/usr/bin/env python3
import csv
import json
import glob
import unicodedata
import re
import os
from datetime import datetime
from collections import defaultdict
import difflib

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
CLUBS_FILE = os.path.join(DATA_DIR, 'clubs.json')
OUT_MATCHES = os.path.join(DATA_DIR, 'matches_full.json')
OUT_RATINGS = os.path.join(DATA_DIR, 'ratings.json')
OUT_RATINGS_HA = os.path.join(DATA_DIR, 'ratings_home_away.json')
OUT_UNMAPPED = os.path.join(DATA_DIR, 'unmapped_names.json')

BASE_ELO = 1800
K = 35
HOME_ADV = 100
SHRINKAGE_TAU = 30  # parâmetro para blendar com overall quando poucos jogos

DATE_FORMATS = [
    '%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y %H:%M', '%Y/%m/%d'
]


def normalize(name):
    if not name:
        return ''
    # NFKD/NFD to separate accents
    n = unicodedata.normalize('NFD', name)
    # remove diacritics
    n = ''.join(ch for ch in n if unicodedata.category(ch) != 'Mn')
    # remove punctuation except spaces
    n = re.sub(r"[\.\'\",:;\-\(\)\[\]/]", '', n)
    n = n.strip().lower()
    return n


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    # try multiple formats
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    # try common US-style if contains '/'
    parts = s.split('/')
    if len(parts) == 3:
        # try month/day/year
        for fmt in ['%m/%d/%Y', '%m/%d/%y']:
            try:
                return datetime.strptime(s, fmt)
            except Exception:
                pass
    # fallback: try ISO parse
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def expected_home(homeElo, awayElo):
    homeAdj = homeElo + HOME_ADV
    return 1 / (1 + 10 ** (-(homeAdj - awayElo) / 400))


def expected_no_homeadv(homeElo, awayElo):
    # expected without adding global HOME_ADV — used when homeElo represents "home" strength already
    return 1 / (1 + 10 ** (-(homeElo - awayElo) / 400))


def margin_multiplier(diff):
    if diff <= 1:
        return 1
    if diff == 2:
        return 1.5
    return (11 + diff) / 8


def update_elo_raw(homePre, awayPre, homeGoals, awayGoals):
    expHome = expected_home(homePre, awayPre)
    expAway = 1 - expHome
    if homeGoals > awayGoals:
        sHome = 1
    elif homeGoals == awayGoals:
        sHome = 0.5
    else:
        sHome = 0
    sAway = 1 - sHome
    diff = abs(homeGoals - awayGoals)
    M = margin_multiplier(diff)
    homeDelta = K * M * (sHome - expHome)
    awayDelta = K * M * (sAway - expAway)
    return homePre + homeDelta, awayPre + awayDelta, homeDelta, awayDelta


def update_elo_no_homeadv(homePre, awayPre, homeGoals, awayGoals):
    # same as update_elo_raw but uses expected_no_homeadv
    expHome = expected_no_homeadv(homePre, awayPre)
    expAway = 1 - expHome
    if homeGoals > awayGoals:
        sHome = 1
    elif homeGoals == awayGoals:
        sHome = 0.5
    else:
        sHome = 0
    sAway = 1 - sHome
    diff = abs(homeGoals - awayGoals)
    M = margin_multiplier(diff)
    homeDelta = K * M * (sHome - expHome)
    awayDelta = K * M * (sAway - expAway)
    return homePre + homeDelta, awayPre + awayDelta, homeDelta, awayDelta


def main():
    # load clubs
    with open(CLUBS_FILE, 'r', encoding='utf-8') as f:
        clubs = json.load(f)

    norm_to_id = {}
    id_to_name = {}
    for c in clubs:
        nm = c.get('name')
        cid = c.get('id')
        if nm and cid is not None:
            norm_to_id[normalize(nm)] = cid
            id_to_name[cid] = nm

    # gather csv files
    csv_files = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    csv_files = [p for p in csv_files if os.path.basename(p).lower() not in ('clubs.csv',)]

    matches = []
    unmapped = set()
    processed = 0
    skipped = 0

    for p in csv_files:
        try:
            with open(p, 'r', encoding='utf-8') as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    date_s = row.get('Date') or row.get('date')
                    home = row.get('HomeTeam') or row.get('Home') or row.get('home')
                    away = row.get('AwayTeam') or row.get('Away') or row.get('away')
                    fthg = row.get('FTHG') or row.get('HomeGoals') or row.get('FTHG')
                    ftag = row.get('FTAG') or row.get('AwayGoals') or row.get('FTAG')

                    if not home or not away:
                        skipped += 1
                        continue
                    hid = norm_to_id.get(normalize(home))
                    aid = norm_to_id.get(normalize(away))
                    if not hid:
                        unmapped.add(home)
                    if not aid:
                        unmapped.add(away)
                    if not hid or not aid:
                        skipped += 1
                        continue

                    try:
                        hg = int(fthg) if fthg is not None and fthg != '' else 0
                    except Exception:
                        hg = 0
                    try:
                        ag = int(ftag) if ftag is not None and ftag != '' else 0
                    except Exception:
                        ag = 0

                    dt = parse_date(date_s)
                    matches.append({
                        'date_raw': date_s,
                        'date': dt.isoformat() if dt else None,
                        'date_obj': dt,
                        'home': hid,
                        'away': aid,
                        'homeGoals': hg,
                        'awayGoals': ag,
                        'source': os.path.basename(p)
                    })
                    processed += 1
        except Exception as e:
            print('Failed to read', p, e)

    # sort matches by date if possible, otherwise keep original order
    matches.sort(key=lambda m: (m['date_obj'] is None, m['date_obj'] or datetime.min))

    # compute overall ELO (single rating) and also home/away ratings
    overall_elos = {c['id']: BASE_ELO for c in clubs}
    home_elos = {c['id']: BASE_ELO for c in clubs}
    away_elos = {c['id']: BASE_ELO for c in clubs}

    # counters for shrinkage
    home_counts = defaultdict(int)
    away_counts = defaultdict(int)

    last_date = None
    for m in matches:
        hid = m['home']
        aid = m['away']
        hg = m['homeGoals']
        ag = m['awayGoals']

        # update overall (previous behavior)
        pre_h = overall_elos.get(hid, BASE_ELO)
        pre_a = overall_elos.get(aid, BASE_ELO)
        new_h, new_a, hd, ad = update_elo_raw(pre_h, pre_a, hg, ag)
        overall_elos[hid] = new_h
        overall_elos[aid] = new_a

        # update home/away separately: homeElos[home] vs awayElos[away]
        pre_h_home = home_elos.get(hid, BASE_ELO)
        pre_a_away = away_elos.get(aid, BASE_ELO)
        # use no-homeadv variant because these ratings already represent home/away strengths
        new_h_home, new_a_away, hd2, ad2 = update_elo_no_homeadv(pre_h_home, pre_a_away, hg, ag)
        home_elos[hid] = new_h_home
        away_elos[aid] = new_a_away

        home_counts[hid] += 1
        away_counts[aid] += 1

        last_date = m['date'] or last_date
        m['homeEloPre'] = pre_h_home
        m['awayEloPre'] = pre_a_away
        m['homeEloPost'] = new_h_home
        m['awayEloPost'] = new_a_away
        m['homeDelta'] = hd2
        m['awayDelta'] = ad2

    # apply shrinkage blending home/away with overall to stabilize few-games teams
    ratings_ha = []
    for c in clubs:
        cid = c['id']
        h_val = home_elos.get(cid, BASE_ELO)
        a_val = away_elos.get(cid, BASE_ELO)
        o_val = overall_elos.get(cid, BASE_ELO)
        hn = home_counts.get(cid, 0)
        an = away_counts.get(cid, 0)
        # blend: weight = n / (n + tau)
        h_weight = hn / (hn + SHRINKAGE_TAU) if hn is not None else 0
        a_weight = an / (an + SHRINKAGE_TAU) if an is not None else 0
        final_h = h_weight * h_val + (1 - h_weight) * o_val
        final_a = a_weight * a_val + (1 - a_weight) * o_val
        overall = (final_h + final_a) / 2
        ratings_ha.append({'clubId': cid, 'homeElo': round(final_h, 2), 'awayElo': round(final_a, 2), 'overallElo': round(overall, 2), 'homeGames': hn, 'awayGames': an})

    # assign match ids and drop date_obj
    for i, m in enumerate(matches, start=1):
        m['id'] = i
        if 'date_obj' in m:
            del m['date_obj']

    # write matches file
    with open(OUT_MATCHES, 'w', encoding='utf-8') as f:
        json.dump(matches, f, ensure_ascii=False, indent=2)

    # write ratings home/away
    with open(OUT_RATINGS_HA, 'w', encoding='utf-8') as f:
        json.dump(ratings_ha, f, ensure_ascii=False, indent=2)

    # prepare overall ratings (use overall_elos final values)
    ratings_out = []
    for cid, val in overall_elos.items():
        ratings_out.append({
            'clubId': cid,
            'date': last_date or datetime.utcnow().date().isoformat(),
            'elo': round(val, 2)
        })

    with open(OUT_RATINGS, 'w', encoding='utf-8') as f:
        json.dump(ratings_out, f, ensure_ascii=False, indent=2)

    # unmapped suggestions using difflib
    suggestions = {}
    club_norms = list(norm_to_id.keys())
    for name in sorted(unmapped):
        nrm = normalize(name)
        choices = difflib.get_close_matches(nrm, club_norms, n=5, cutoff=0.7)
        suggestions[name] = choices

    with open(OUT_UNMAPPED, 'w', encoding='utf-8') as f:
        json.dump(suggestions, f, ensure_ascii=False, indent=2)

    print(f'Processed matches: {processed}, skipped (unmapped or invalid): {skipped}')
    print(f'Wrote {len(matches)} matches to {OUT_MATCHES}')
    print(f'Wrote ratings for {len(ratings_ha)} clubs to {OUT_RATINGS_HA} and overall to {OUT_RATINGS}')
    if suggestions:
        print(f'Wrote unmapped suggestions for {len(suggestions)} names to {OUT_UNMAPPED}')


if __name__ == '__main__':
    main()
