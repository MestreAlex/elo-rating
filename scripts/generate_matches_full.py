#!/usr/bin/env python3
"""
Script para gerar matches_full.json a partir de todos os CSVs de ligas
Processa cada match calculando ELO ratings pré e pós-match
"""

import os
import json
import csv
from datetime import datetime
from pathlib import Path
from collections import defaultdict

# Configurações
DATA_FOLDER = os.path.join(os.path.dirname(__file__), "..", "data")
OUTPUT_FILE = os.path.join(DATA_FOLDER, "matches_full.json")

# Arquivo de mapeamento de clubes
CLUBS_FILE = os.path.join(DATA_FOLDER, "clubs.json")

# ELO inicial
INITIAL_ELO = 1800
HOME_ADVANTAGE = 100
K_FACTOR = 400

def load_clubs():
    """Carrega o dicionário de clubes"""
    if not os.path.exists(CLUBS_FILE):
        print(f"Arquivo de clubes não encontrado: {CLUBS_FILE}")
        return {}
    
    with open(CLUBS_FILE, 'r', encoding='utf-8') as f:
        clubs_data = json.load(f)
    
    # Criar dicionário {nome_normalizado: {id, nome, liga}}
    clubs = {}
    for club in clubs_data:
        name_key = club.get('name', '').strip().lower()
        if name_key:
            clubs[name_key] = club
    
    return clubs

def expected_score(elo_home, elo_away):
    """Calcula a probabilidade esperada de vitória para o time da casa"""
    return 1 / (1 + 10 ** ((elo_away - elo_home - HOME_ADVANTAGE) / 400))

def calculate_new_elo(elo_current, expected, actual, k=K_FACTOR):
    """Calcula o novo ELO após um match"""
    return elo_current + k * (actual - expected)

def get_club_info(name, clubs):
    """Obtém informações do clube pelo nome"""
    name_key = name.strip().lower()
    if name_key in clubs:
        return clubs[name_key]
    return None

def process_csv_file(filepath, clubs, club_elos):
    """Processa um arquivo CSV e retorna lista de matches"""
    matches = []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                try:
                    # Extrair informações básicas
                    date_raw = row.get('Date', '').strip()
                    home_name = row.get('HomeTeam', '').strip()
                    away_name = row.get('AwayTeam', '').strip()
                    home_goals = row.get('FTHG', '')
                    away_goals = row.get('FTAG', '')
                    
                    # Validar dados
                    if not date_raw or not home_name or not away_name:
                        continue
                    if not home_goals or not away_goals:
                        continue
                    
                    try:
                        home_goals = int(home_goals)
                        away_goals = int(away_goals)
                    except ValueError:
                        continue
                    
                    # Encontrar IDs dos clubes
                    home_club = get_club_info(home_name, clubs)
                    away_club = get_club_info(away_name, clubs)
                    
                    if not home_club or not away_club:
                        print(f"  ⚠️ Clube não encontrado: {home_name} vs {away_name}")
                        continue
                    
                    home_id = home_club['id']
                    away_id = away_club['id']
                    
                    # Obter ELO pré-match
                    home_elo_pre = club_elos[home_id]
                    away_elo_pre = club_elos[away_id]
                    
                    # Calcular ELO pós-match
                    exp_home = expected_score(home_elo_pre, away_elo_pre)
                    
                    if home_goals > away_goals:
                        actual_home = 1.0
                    elif home_goals == away_goals:
                        actual_home = 0.5
                    else:
                        actual_home = 0.0
                    
                    home_elo_post = calculate_new_elo(home_elo_pre, exp_home, actual_home)
                    away_elo_post = calculate_new_elo(away_elo_pre, 1 - exp_home, 1 - actual_home)
                    
                    # Calcular delta
                    home_delta = home_elo_post - home_elo_pre
                    away_delta = away_elo_post - away_elo_pre
                    
                    # Atualizar ELOs para próximo match
                    club_elos[home_id] = home_elo_post
                    club_elos[away_id] = away_elo_post
                    
                    # Parsear data
                    try:
                        # Tentar diferentes formatos
                        date_obj = None
                        for fmt in ['%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d']:
                            try:
                                date_obj = datetime.strptime(date_raw, fmt)
                                break
                            except:
                                continue
                        
                        if not date_obj:
                            print(f"  ⚠️ Data inválida: {date_raw}")
                            continue
                        
                        date_iso = date_obj.isoformat()
                    except:
                        print(f"  ⚠️ Erro ao parsear data: {date_raw}")
                        continue
                    
                    # Criar objeto de match
                    match = {
                        "date_raw": date_raw,
                        "date": date_iso,
                        "home": home_id,
                        "away": away_id,
                        "homeGoals": home_goals,
                        "awayGoals": away_goals,
                        "source": os.path.basename(filepath),
                        "homeEloPre": home_elo_pre,
                        "awayEloPre": away_elo_pre,
                        "homeEloPost": round(home_elo_post, 1),
                        "awayEloPost": round(away_elo_post, 1),
                        "homeDelta": round(home_delta, 1),
                        "awayDelta": round(away_delta, 1),
                    }
                    
                    matches.append(match)
                    
                except Exception as e:
                    continue
        
        return matches
        
    except Exception as e:
        print(f"Erro ao processar {filepath}: {e}")
        return []

def main():
    """Processa todos os CSVs e gera matches_full.json"""
    
    print(f"\n{'='*70}")
    print("Gerando matches_full.json")
    print(f"{'='*70}\n")
    
    # Carregar clubes
    print("📖 Carregando clubes...")
    clubs = load_clubs()
    print(f"   ✓ {len(clubs)} clubes carregados\n")
    
    # Inicializar ELOs de todos os clubes
    club_elos = defaultdict(lambda: INITIAL_ELO)
    
    # Encontrar todos os CSVs
    csv_files = sorted([f for f in os.listdir(DATA_FOLDER) if f.endswith('.csv')])
    print(f"📊 Encontrados {len(csv_files)} arquivos CSV")
    print(f"   {', '.join([f for f in csv_files[:3]])}...")
    print()
    
    # Processar cada CSV
    all_matches = []
    total_processed = 0
    total_skipped = 0
    
    for csv_file in csv_files:
        filepath = os.path.join(DATA_FOLDER, csv_file)
        print(f"⚽ Processando {csv_file}...")
        
        matches = process_csv_file(filepath, clubs, club_elos)
        all_matches.extend(matches)
        
        print(f"   ✓ {len(matches)} matches processados")
        total_processed += len(matches)
    
    print(f"\n{'='*70}")
    print(f"Total de matches: {len(all_matches)}")
    print(f"{'='*70}\n")
    
    # Ordenar por data
    print("📅 Ordenando matches por data...")
    all_matches.sort(key=lambda x: x['date'])
    
    # Adicionar ID sequencial
    print("🔢 Adicionando IDs sequenciais...")
    for i, match in enumerate(all_matches, 1):
        match['id'] = i
    
    # Salvar em JSON
    print(f"💾 Salvando em {os.path.basename(OUTPUT_FILE)}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_matches, f, indent=2, ensure_ascii=False)
    
    file_size = os.path.getsize(OUTPUT_FILE)
    print(f"   ✓ Salvo com sucesso ({file_size:,} bytes)\n")
    
    print(f"{'='*70}")
    print(f"✅ Processo completo!")
    print(f"   Total de matches: {len(all_matches)}")
    print(f"   Arquivo: {OUTPUT_FILE}")
    print(f"{'='*70}\n")

if __name__ == "__main__":
    main()
