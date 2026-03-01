const mysql = require("mysql2");

console.log("MYSQLHOST:", process.env.MYSQLHOST);
console.log("MYSQLUSER:", process.env.MYSQLUSER);
console.log("MYSQLPORT:", process.env.MYSQLPORT);

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

db.connect((err) => {
  if (err) {
    console.log("Database connection failed:", err);
  } else {
    console.log("Connected to Database 🚀");
  }
});

module.exports = db;