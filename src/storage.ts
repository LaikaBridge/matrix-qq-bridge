import Database from 'better-sqlite3';
export class LocalStorage{

    db: Database.Database
    constructor(filename: string){
        this.db = new Database(filename);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY, value TEXT)`);
    }
    getItem(key: string): string | null{
        const stmt = this.db.prepare(`SELECT value FROM storage WHERE key = ?`);
        const row = stmt.get(key) as {value: string};
        if(row){
            return row.value;
        }
        return null;
    }
    setItem(key: string, value: string): void{
        const stmt = this.db.prepare(`INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`);
        stmt.run(key, value, value);
    }
}