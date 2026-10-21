#!/usr/bin/env python3
"""Build the General Auditor reference from the user-supplied served-facility CSV.

Usage: python3 scripts/import-served-facilities.py [CSV_PATH]
The CSV is data only. No IDs, aliases or missing geography are inferred.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'health-facilities-2026-10-19.csv'
OUTPUT = ROOT / 'server' / 'data' / 'served-facilities.json'
COLUMNS = ['COUNTRY', 'Locality/District', 'HEALTH_FACILITY_NAME', 'Region/County', 'Facility Group']


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def build(raw):
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline=''))
    if reader.fieldnames != COLUMNS:
        raise ValueError(f'Expected columns: {COLUMNS}; got {reader.fieldnames}')
    records, seen, duplicates = [], {}, []
    missing = dict.fromkeys(COLUMNS, 0)
    count = 0
    for line, row in enumerate(reader, 2):
        if None in row or any(row[column] is None for column in COLUMNS):
            raise ValueError(f'Malformed CSV record at line {line}')
        count += 1
        for column in COLUMNS:
            missing[column] += not row[column].strip()
        if not row['HEALTH_FACILITY_NAME'].strip():
            raise ValueError(f'Missing facility name at line {line}')
        values = {column: ' '.join(row[column].split()) for column in COLUMNS}
        # Deduplicate only complete equal records, including type and geography.
        key = tuple(normalized(values[column]) for column in COLUMNS)
        if key in seen:
            duplicates.append({'row': line, 'sameAsRow': seen[key]})
            continue
        seen[key] = line
        records.append({
            'name': values['HEALTH_FACILITY_NAME'],
            'district': values['Locality/District'],
            'region': values['Region/County'],
            'facilityType': values['Facility Group'],
            'country': values['COUNTRY'],
            'source': f'{SOURCE.relative_to(ROOT).as_posix()}:row{line}'
        })
    return {
        'sourceFile': SOURCE.relative_to(ROOT).as_posix(),
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'sourceRowCount': count,
        'recordCount': len(records),
        'duplicateRows': duplicates,
        'missingValues': missing,
        'records': records
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path', nargs='?', type=Path, default=SOURCE)
    args = parser.parse_args()
    raw = args.csv_path.read_bytes()
    result = build(raw)  # Validate completely before changing reference files.
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if args.csv_path.resolve() != SOURCE.resolve():
        shutil.copyfile(args.csv_path, SOURCE)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Imported {result["recordCount"]} distinct facility records from {result["sourceRowCount"]} rows; {len(result["duplicateRows"])} repeated rows retained in provenance.')


if __name__ == '__main__':
    main()
