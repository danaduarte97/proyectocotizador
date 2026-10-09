#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        transactionOpen = true;

        const source = (await client.query(`
            SELECT current_database() AS base, current_schema() AS esquema
        `)).rows[0];
        const clientes = (await client.query(
            "SELECT * FROM public.clientes ORDER BY id"
        )).rows;
        const cotizaciones = (await client.query(
            "SELECT * FROM public.cotizaciones ORDER BY id"
        )).rows;
        const identidades = (await client.query(
            "SELECT * FROM public.primer_contacto_identidades ORDER BY id"
        )).rows;
        const procedencias = (await client.query(
            "SELECT * FROM public.procedencias ORDER BY id"
        )).rows;
        const usuariosReferencia = (await client.query(`
            SELECT id, usuario, rol
            FROM public.usuarios
            ORDER BY id
        `)).rows;

        await client.query("ROLLBACK");
        transactionOpen = false;

        const backup = {
            created_at: new Date().toISOString(),
            source,
            read_mode: "PostgreSQL READ ONLY; finalizado con ROLLBACK",
            nota_usuarios: "Se excluyen hashes de contraseña y teléfonos",
            tables: {
                clientes,
                cotizaciones,
                primer_contacto_identidades: identidades,
                procedencias,
                usuarios_referencia: usuariosReferencia
            }
        };
        const content = JSON.stringify(backup, null, 2);
        const checksum = crypto.createHash("sha256").update(content).digest("hex");
        const backupsDir = path.resolve(__dirname, "..", "backups");
        const backupPath = path.join(
            backupsDir,
            `oportunidades-fase-a-pre-migration-${timestamp()}.json`
        );

        fs.mkdirSync(backupsDir, { recursive: true });
        fs.writeFileSync(backupPath, content, { encoding: "utf8", flag: "wx" });

        console.log(JSON.stringify({
            resultado: "BACKUP_LOCAL_OK",
            backup_path: backupPath,
            sha256: checksum,
            clientes: clientes.length,
            cotizaciones: cotizaciones.length,
            identidades_primer_contacto: identidades.length,
            procedencias: procedencias.length,
            usuarios_referencia: usuariosReferencia.length
        }, null, 2));
    } finally {
        if (transactionOpen) {
            await client.query("ROLLBACK").catch(() => { });
        }
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
