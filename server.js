const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || "sbi_posp_uat";

function getDbConfig() {
  const required = ["DB_HOST", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length) {
    throw new Error("Missing database environment variables");
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: DB_NAME,
    connectTimeout: 10000,
    ssl: process.env.DB_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined
  };
}

async function withDb(callback) {
  const db = await mysql.createConnection(getDbConfig());

  try {
    return await callback(db);
  } finally {
    await db.end();
  }
}

// API homepage
app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "L0RD_DANZO API",
    developer: "@L0RD_DANZO",
    version: "1.0.0",
    status: "online",
    endpoints: [
      "/health",
      "/api/tables",
      "/api/banks?page=1&limit=20"
    ]
  });
});

// Database connection check
app.get("/health", async (req, res) => {
  try {
    await withDb(db => db.ping());

    res.json({
      success: true,
      message: "Database connected"
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database unavailable. Check configuration."
    });
  }
});

// List database tables
app.get("/api/tables", async (req, res) => {
  try {
    const tables = await withDb(async db => {
      const [rows] = await db.execute(
        `SELECT TABLE_NAME
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [DB_NAME]
      );

      return rows.map(row => row.TABLE_NAME);
    });

    res.json({
      success: true,
      total: tables.length,
      tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not retrieve tables"
    });
  }
});

// Fetch non-sensitive bank reference data
app.get("/api/banks", async (req, res) => {
  const page = Math.max(
    1,
    parseInt(req.query.page, 10) || 1
  );

  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit, 10) || 20)
  );

  const offset = (page - 1) * limit;

  try {
    const result = await withDb(async db => {
      const [columns] = await db.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [DB_NAME, "bankmaster"]
      );

      if (!columns.length) {
        return { missingTable: true, data: [], total: 0 };
      }

      const blocked =
        /mobile|phone|account|customer|address|email|password|token|aadhaar|aadhar|pan|dob|birth|otp|secret|credential/i;

      const safeColumns = columns
        .map(column => column.COLUMN_NAME)
        .filter(name =>
          /^[A-Za-z0-9_]+$/.test(name) &&
          !blocked.test(name)
        );

      if (!safeColumns.length) {
        return { missingTable: false, data: [], total: 0 };
      }

      const selectList = safeColumns
        .map(name => `\`${name}\``)
        .join(", ");

      const [rows] = await db.query(
        `SELECT ${selectList}
         FROM \`bankmaster\`
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      const [[count]] = await db.query(
        "SELECT COUNT(*) AS total FROM `bankmaster`"
      );

      return {
        missingTable: false,
        data: rows,
        total: Number(count.total)
      };
    });

    if (result.missingTable) {
      return res.status(404).json({
        success: false,
        message: "bankmaster table not found"
      });
    }

    res.json({
      success: true,
      name: "L0RD_DANZO API",
      developer: "@L0RD_DANZO",
      page,
      limit,
      total: result.total,
      data: result.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Unable to fetch data. Check database settings."
    });
  }
});

// Vercel serverless handler
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`L0RD_DANZO API running on port ${PORT}`);
  });
}

module.exports = app;