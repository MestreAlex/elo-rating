#!/usr/bin/env python3
"""
Script para baixar dados de temporadas de futebol do site football-data.co.uk
e salvar na pasta data/ com o padrão LIGA_TEMPORADA.csv
"""

import os
import requests
from datetime import datetime
from pathlib import Path

# Configurações
BASE_URL = "https://www.football-data.co.uk/mmz4281"
DATA_FOLDER = os.path.join(os.path.dirname(__file__), "..", "data")

# Ligas disponíveis (código do site -> nome local)
LEAGUES = {
    "E0": "Premier League (England)",
    "E1": "Championship (England)",
    "D1": "Bundesliga (Germany)",
    "D2": "2. Bundesliga (Germany)",
    "F1": "Ligue 1 (France)",
    "F2": "Ligue 2 (France)",
    "I1": "Serie A (Italy)",
    "I2": "Serie B (Italy)",
    "SP1": "La Liga (Spain)",
    "SP2": "Segunda División (Spain)",
    "P1": "Liga I (Portugal)",
    "N1": "Eredivisie (Netherlands)",
    "SC0": "Scottish Premiership (Scotland)",
    "B1": "Jupiler Pro League (Belgium)",
    "T1": "Süper Lig (Turkey)",
    "G1": "Super League (Greece)",
}

# Temporadas disponíveis (formato no site: 1920 = 2019/2020)
SEASONS = [
    ("1516", "2015/2016"),
    ("1617", "2016/2017"),
    ("1718", "2017/2018"),
    ("1819", "2018/2019"),
    ("1920", "2019/2020"),
    ("2021", "2020/2021"),
    ("2122", "2021/2022"),
    ("2223", "2022/2023"),
    ("2324", "2023/2024"),
    ("2425", "2024/2025"),
    ("2526", "2025/2026"),
]

def download_file(url, filepath):
    """Baixa um arquivo e salva no caminho especificado"""
    try:
        print(f"  Baixando: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        with open(filepath, 'wb') as f:
            f.write(response.content)
        
        # Obter tamanho do arquivo
        size = os.path.getsize(filepath)
        print(f"  ✓ Salvo: {os.path.basename(filepath)} ({size} bytes)")
        return True
    except requests.exceptions.RequestException as e:
        print(f"  ✗ Erro ao baixar: {e}")
        return False
    except Exception as e:
        print(f"  ✗ Erro ao salvar: {e}")
        return False

def download_seasons(leagues=None, seasons=None, skip_existing=True):
    """
    Baixa dados de temporadas de futebol
    
    Args:
        leagues: Lista de códigos de liga (ex: ['E0', 'E1']). Se None, usa todas.
        seasons: Lista de tuplas (código, nome) de temporadas. Se None, usa todas.
        skip_existing: Se True, pula arquivos que já existem
    """
    if not os.path.exists(DATA_FOLDER):
        os.makedirs(DATA_FOLDER)
        print(f"Pasta criada: {DATA_FOLDER}")
    
    if leagues is None:
        leagues = list(LEAGUES.keys())
    
    if seasons is None:
        seasons = SEASONS
    
    total = len(leagues) * len(seasons)
    downloaded = 0
    skipped = 0
    failed = 0
    
    print(f"\n{'='*70}")
    print(f"Download de dados de futebol")
    print(f"{'='*70}")
    print(f"Ligas: {', '.join(leagues)}")
    print(f"Temporadas: {len(seasons)}")
    print(f"Total de arquivos: {total}")
    print(f"{'='*70}\n")
    
    for league in leagues:
        league_name = LEAGUES.get(league, league)
        print(f"\n🏆 {league} - {league_name}")
        print(f"  {'-'*60}")
        
        for season_code, season_name in seasons:
            # Construir nomes de arquivo
            filename = f"{league}_{season_code}.csv"
            filepath = os.path.join(DATA_FOLDER, filename)
            
            # Verificar se arquivo já existe
            if os.path.exists(filepath) and skip_existing:
                print(f"  ⊘ {filename} (já existe)")
                skipped += 1
                continue
            
            # Construir URL
            url = f"{BASE_URL}/{season_code}/{league}.csv"
            
            # Baixar arquivo
            if download_file(url, filepath):
                downloaded += 1
            else:
                failed += 1
    
    # Resumo
    print(f"\n{'='*70}")
    print(f"Resumo:")
    print(f"  ✓ Baixados: {downloaded}")
    print(f"  ⊘ Pulados (já existem): {skipped}")
    print(f"  ✗ Falhados: {failed}")
    print(f"  Total processado: {downloaded + skipped + failed}/{total}")
    print(f"{'='*70}\n")
    
    return downloaded, skipped, failed

def list_available_files():
    """Lista os arquivos disponíveis na pasta data"""
    if not os.path.exists(DATA_FOLDER):
        print("Pasta data/ não encontrada")
        return
    
    files = sorted([f for f in os.listdir(DATA_FOLDER) if f.endswith('.csv')])
    
    print(f"\n{'='*70}")
    print(f"Arquivos CSV disponíveis na pasta data/")
    print(f"{'='*70}")
    
    for file in files:
        filepath = os.path.join(DATA_FOLDER, file)
        size = os.path.getsize(filepath)
        print(f"  {file:<20} ({size:>10} bytes)")
    
    print(f"\nTotal: {len(files)} arquivos")
    print(f"{'='*70}\n")

if __name__ == "__main__":
    import sys
    
    # Opções de linha de comando
    if len(sys.argv) > 1:
        if sys.argv[1] == "list":
            list_available_files()
        elif sys.argv[1] == "all":
            download_seasons(skip_existing=True)
        elif sys.argv[1] == "force":
            # Baixar tudo, mesmo que já exista
            download_seasons(skip_existing=False)
        else:
            # Interpretar como ligas específicas
            leagues = sys.argv[1:]
            download_seasons(leagues=leagues, skip_existing=True)
    else:
        # Modo interativo
        print(f"\nUso:")
        print(f"  python download_seasons.py list                # Listar arquivos disponíveis")
        print(f"  python download_seasons.py all                 # Baixar todas as ligas e temporadas")
        print(f"  python download_seasons.py force               # Forçar download (sobrescrever)")
        print(f"  python download_seasons.py E0 E1 D1            # Baixar ligas específicas")
        print(f"\nExecutando com a opção padrão (all)...\n")
        download_seasons(skip_existing=True)
