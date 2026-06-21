require("dotenv").config();

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const usePostgres = Boolean(process.env.DATABASE_URL);
const useLegacySqliteBackup = process.env.USE_LEGACY_SQLITE_BACKUP === "true";

if (!usePostgres && !useLegacySqliteBackup) {
    throw new Error(
        "Falta DATABASE_URL. Supabase es la base activa; database.db queda solo como respaldo local viejo. " +
        "Para abrir ese respaldo de forma intencional, usar USE_LEGACY_SQLITE_BACKUP=true."
    );
}

function postgresSql(sql) {
    let index = 0;

    return sql
        .replace(/\?/g, () => `$${++index}`)
        .replace(/date\(fecha\)/g, "fecha::date")
        .replace(/date\(\$(\d+)\)/g, "$$$1::date");
}

function withReturningId(sql) {
    if (
        /^\s*INSERT\s+INTO\s+cotizaciones\b/i.test(sql) &&
        !/\bRETURNING\b/i.test(sql)
    ) {
        return `${sql} RETURNING id`;
    }

    return sql;
}

function createPostgresDatabase() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    async function query(sql, params = [], client = pool) {
        return client.query(postgresSql(sql), params);
    }

    return {
        type: "postgres",
        pool,
        toNativeSql: postgresSql,

        async get(sql, params = [], callback) {
            try {
                const result = await query(sql, params);
                callback(null, result.rows[0]);
            } catch (error) {
                callback(error);
            }
        },

        async all(sql, params = [], callback) {
            try {
                const result = await query(sql, params);
                callback(null, result.rows);
            } catch (error) {
                callback(error);
            }
        },

        async run(sql, params = [], callback = () => { }) {
            try {
                const result = await query(withReturningId(sql), params);
                callback.call(
                    {
                        lastID: result.rows[0]?.id,
                        changes: result.rowCount
                    },
                    null
                );
            } catch (error) {
                callback(error);
            }
        },

        async transaction(callback) {
            const client = await pool.connect();

            try {
                await client.query("BEGIN");

                const tx = {
                    get: async (sql, params = []) => {
                        const result = await query(sql, params, client);
                        return result.rows[0];
                    },
                    all: async (sql, params = []) => {
                        const result = await query(sql, params, client);
                        return result.rows;
                    },
                    run: async (sql, params = []) => {
                        const result = await query(
                            withReturningId(sql),
                            params,
                            client
                        );

                        return {
                            lastID: result.rows[0]?.id,
                            changes: result.rowCount
                        };
                    }
                };

                const value = await callback(tx);
                await client.query("COMMIT");
                return value;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        }
    };
}

function createSqliteDatabase() {
    const sqlite = new sqlite3.Database(path.join(__dirname, "database.db"));

    sqlite.type = "sqlite";
    sqlite.toNativeSql = sql => sql;

    sqlite.transaction = callback => new Promise((resolve, reject) => {
        sqlite.run("BEGIN TRANSACTION", errBegin => {
            if (errBegin) {
                reject(errBegin);
                return;
            }

            const tx = {
                get: (sql, params = []) => new Promise((resolveGet, rejectGet) => {
                    sqlite.get(sql, params, (err, row) => {
                        if (err) rejectGet(err);
                        else resolveGet(row);
                    });
                }),
                all: (sql, params = []) => new Promise((resolveAll, rejectAll) => {
                    sqlite.all(sql, params, (err, rows) => {
                        if (err) rejectAll(err);
                        else resolveAll(rows);
                    });
                }),
                run: (sql, params = []) => new Promise((resolveRun, rejectRun) => {
                    sqlite.run(sql, params, function (err) {
                        if (err) {
                            rejectRun(err);
                            return;
                        }

                        resolveRun({
                            lastID: this.lastID,
                            changes: this.changes
                        });
                    });
                })
            };

            Promise.resolve()
                .then(() => callback(tx))
                .then(value => {
                    sqlite.run("COMMIT", errCommit => {
                        if (errCommit) reject(errCommit);
                        else resolve(value);
                    });
                })
                .catch(error => {
                    sqlite.run("ROLLBACK", () => reject(error));
                });
        });
    });

    return sqlite;
}

module.exports = usePostgres
    ? createPostgresDatabase()
    : createSqliteDatabase();
