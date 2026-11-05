#!/usr/bin/env python3
"""Inspect SQLite database schema, tables, and data integrity."""

import sqlite3
import os
from pathlib import Path
import json

def inspect_database(db_path):
    """Inspect and report on SQLite database."""
    
    if not os.path.exists(db_path):
        print(f'ERROR: {db_path} not found')
        return False
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print('=' * 80)
    print('SQLITE DATABASE SCHEMA INSPECTION')
    print('=' * 80)
    print(f'\nDatabase: {db_path}')
    print(f'File Size: {os.path.getsize(db_path) / 1024:.2f} KB')
    
    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = cursor.fetchall()
    
    print(f'Tables Found: {len(tables)}')
    print('-' * 80)
    
    table_info = {}
    
    for (table_name,) in tables:
        print(f'\nTABLE: {table_name}')
        
        # Get columns
        cursor.execute(f'PRAGMA table_info({table_name})')
        columns = cursor.fetchall()
        print(f'  Columns: {len(columns)}')
        
        col_list = []
        for col_id, col_name, col_type, not_null, default_val, pk in columns:
            pk_marker = ' [PRIMARY KEY]' if pk else ''
            null_marker = ' NOT NULL' if not_null else ''
            default_str = f' DEFAULT {default_val}' if default_val else ''
            print(f'    - {col_name}: {col_type}{pk_marker}{null_marker}{default_str}')
            col_list.append({
                'name': col_name,
                'type': col_type,
                'pk': bool(pk),
                'not_null': bool(not_null),
                'default': default_val
            })
        
        # Get row count
        cursor.execute(f'SELECT COUNT(*) FROM {table_name}')
        row_count = cursor.fetchone()[0]
        print(f'  Rows: {row_count}')
        
        # Get indexes
        cursor.execute(f'PRAGMA index_list({table_name})')
        indexes = cursor.fetchall()
        index_list = []
        if indexes:
            print(f'  Indexes:')
            for idx_seq, idx_name, unique, origin, partial in indexes:
                print(f'    - {idx_name} (unique={bool(unique)}, origin={origin})')
                index_list.append({
                    'name': idx_name,
                    'unique': bool(unique),
                    'origin': origin
                })
        
        table_info[table_name] = {
            'row_count': row_count,
            'columns': col_list,
            'indexes': index_list
        }
    
    # Check for foreign keys
    print('\n' + '=' * 80)
    print('FOREIGN KEYS')
    print('=' * 80)
    
    cursor.execute("PRAGMA foreign_keys = ON")
    has_fks = False
    
    for (table_name,) in tables:
        cursor.execute(f'PRAGMA foreign_key_list({table_name})')
        fks = cursor.fetchall()
        if fks:
            has_fks = True
            print(f'\n{table_name}:')
            for seq, table, from_col, to_col, on_delete, on_update, match in fks:
                print(f'  {from_col} -> {table}.{to_col} (on_delete={on_delete})')
    
    if not has_fks:
        print('No foreign keys defined')
    
    # Check database integrity
    print('\n' + '=' * 80)
    print('DATABASE INTEGRITY CHECK')
    print('=' * 80)
    cursor.execute('PRAGMA integrity_check')
    integrity = cursor.fetchone()[0]
    print(f'Result: {integrity}')
    
    if integrity != 'ok':
        print('[WARNING] DATABASE INTEGRITY ISSUE DETECTED')
    else:
        print('[OK] Database integrity verified')
    
    # Check for budget-related tables
    print('\n' + '=' * 80)
    print('BUDGET GUARD TABLES')
    print('=' * 80)
    
    budget_tables = [
        'higgsfield_jobs',
        'budget_ledger',
        'budget_daily_summary',
        'budget_monthly_summary'
    ]
    
    for budget_table in budget_tables:
        if budget_table in [t[0] for t in tables]:
            print(f'\n[OK] {budget_table} EXISTS')
            cursor.execute(f'SELECT COUNT(*) FROM {budget_table}')
            count = cursor.fetchone()[0]
            print(f'  Records: {count}')
            
            if count > 0:
                # Show sample data
                cursor.execute(f'SELECT * FROM {budget_table} LIMIT 2')
                cols = [description[0] for description in cursor.description]
                rows = cursor.fetchall()
                print(f'  Sample data:')
                for row in rows:
                    print(f'    {dict(zip(cols, row))}')
        else:
            print(f'\n[MISSING] {budget_table} NOT FOUND')
    
    conn.close()
    print('\n' + '=' * 80)
    
    return True, table_info

if __name__ == '__main__':
    success, info = inspect_database('data/studio.sqlite3')
    if success:
        print('\n[OK] Database inspection complete')
        print(f'\nFound {len(info)} tables')
