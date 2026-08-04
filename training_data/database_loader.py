"""
Scientific Database Loader for Agent Training

This module loads structured scientific database information from JSON files
and integrates them into the agent's knowledge base for training purposes.
"""

import json
from pathlib import Path
from typing import Dict, List, Any


class ScientificDatabaseLoader:
    """Loads and manages scientific database information for agent training."""
    
    def __init__(self, data_dir: str = "training_data"):
        self.data_dir = Path(data_dir)
        self.databases: List[Dict[str, Any]] = []
        
    def load_database_file(self, filename: str) -> List[Dict[str, Any]]:
        """Load a JSON file containing scientific database entries."""
        filepath = self.data_dir / filename
        if not filepath.exists():
            raise FileNotFoundError(f"Database file not found: {filepath}")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if isinstance(data, list):
            self.databases.extend(data)
        elif isinstance(data, dict):
            self.databases.append(data)
        else:
            raise ValueError(f"Unexpected data format in {filename}")
        
        return data
    
    def get_by_category(self, category: str) -> List[Dict[str, Any]]:
        """Filter databases by category."""
        return [db for db in self.databases if db.get('category') == category]
    
    def get_by_discipline(self, discipline: str) -> List[Dict[str, Any]]:
        """Filter databases by discipline."""
        return [
            db for db in self.databases 
            if discipline.lower() in [d.lower() for d in db.get('disciplines', [])]
        ]
    
    def get_by_access_type(self, access_type: str) -> List[Dict[str, Any]]:
        """Filter databases by access type (open-access, open-source, commercial)."""
        return [
            db for db in self.databases 
            if db.get('access_type') == access_type
        ]
    
    def search(self, query: str) -> List[Dict[str, Any]]:
        """Search databases by name, description, or features."""
        query_lower = query.lower()
        results = []
        for db in self.databases:
            searchable_text = (
                f"{db.get('name', '')} {db.get('description', '')} "
                f"{' '.join(db.get('features', []))} {' '.join(db.get('disciplines', []))}"
            ).lower()
            if query_lower in searchable_text:
                results.append(db)
        return results
    
    def get_all(self) -> List[Dict[str, Any]]:
        """Return all loaded databases."""
        return self.databases.copy()
    
    def to_training_format(self) -> str:
        """Convert loaded databases to a training-ready text format."""
        lines = []
        lines.append("# Scientific Databases for Open Science")
        lines.append("")
        lines.append("The following databases provide open-access data, laboratory procedures,")
        lines.append("and computational code across all disciplines of science:")
        lines.append("")
        
        # Group by category
        categories = {
            'lab_procedures': '🔬 Open Lab Procedures & Step-by-Step Execution',
            'computational_platforms': '💻 Computational Coding & Open Science Platforms',
            'data_repositories': '📊 All-Science Open Data Repositories'
        }
        
        for category, title in categories.items():
            dbs = self.get_by_category(category)
            if dbs:
                lines.append(f"## {title}")
                lines.append("")
                for db in dbs:
                    lines.append(f"* **{db['name']}** ({db['url']})")
                    lines.append(f"  - {db['description']}")
                    lines.append(f"  - Disciplines: {', '.join(db['disciplines'])}")
                    lines.append(f"  - Features: {', '.join(db['features'])}")
                    lines.append(f"  - Access: {db['access_type']}")
                    lines.append("")
                lines.append("")
        
        return "\n".join(lines)


def main():
    """Load and display scientific databases."""
    loader = ScientificDatabaseLoader()
    
    # Load the scientific databases JSON file
    try:
        loader.load_database_file("scientific_databases.json")
        print(f"Loaded {len(loader.get_all())} scientific databases")
        print("\n" + "="*60 + "\n")
        print(loader.to_training_format())
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
