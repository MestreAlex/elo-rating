import csv
import glob
import json
import os

league_map = {
    'E0': 'Premier League',
    'E1': 'Championship',
    'SP1': 'La Liga',
    'SP2': 'Segunda División',
    'I1': 'Serie A',
    'I2': 'Serie B',
    'F1': 'Ligue 1',
    'F2': 'Ligue 2',
    'D1': 'Bundesliga',
    'D2': 'Bundesliga 2'
}

files = sorted(glob.glob('data/*.csv'))
teams = {}

for f in files:
    base = os.path.basename(f)
    code = base.split('_')[0]
    league = league_map.get(code, code)
    try:
        with open(f, encoding='utf-8') as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                home = row.get('HomeTeam') or row.get('Home') or row.get('HomeTeam ')
                away = row.get('AwayTeam') or row.get('Away') or row.get('AwayTeam ')
                if home:
                    name = home.strip()
                    if name:
                        if name not in teams:
                            teams[name] = { 'name': name, 'leagues': set(), 'continent': 'Europe' }
                        teams[name]['leagues'].add(league)
                if away:
                    name = away.strip()
                    if name:
                        if name not in teams:
                            teams[name] = { 'name': name, 'leagues': set(), 'continent': 'Europe' }
                        teams[name]['leagues'].add(league)
    except Exception as e:
        print(f"Failed to read {f}: {e}")

# Build clubs array with an id and primary league
clubs = []
next_id = 1
for name in sorted(teams.keys()):
    leagues = sorted(teams[name]['leagues'])
    primary_league = leagues[0] if leagues else ''
    clubs.append({
        'id': next_id,
        'name': name,
        'league': primary_league,
        'continent': teams[name]['continent']
    })
    next_id += 1

# Write generated file
out_path = 'data/generated_clubs.json'
with open(out_path, 'w', encoding='utf-8') as out:
    json.dump(clubs, out, ensure_ascii=False, indent=2)

# Also overwrite data/clubs.json
with open('data/clubs.json', 'w', encoding='utf-8') as out:
    json.dump(clubs, out, ensure_ascii=False, indent=2)

print(f"Wrote {len(clubs)} clubs to data/clubs.json")
