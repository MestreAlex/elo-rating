#!/usr/bin/env python3
import json

data = json.load(open('data/matches_full.json'))
print(f'✓ Total de matches: {len(data)}')
print(f'✓ Data do primeiro: {data[0]["date_raw"]} ({data[0]["source"]})')
print(f'✓ Data do último: {data[-1]["date_raw"]} ({data[-1]["source"]})')

# Contar por liga
sources = {}
for match in data:
    source = match['source']
    if source not in sources:
        sources[source] = 0
    sources[source] += 1

print(f'\n📊 Distribuição por liga:')
for source in sorted(sources.keys()):
    print(f'  {source}: {sources[source]} matches')
