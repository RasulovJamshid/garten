#!/usr/bin/env node
// Applies the retention policy from kindergarten-docs/docs/06-ops-reference.md
// §6 ("retention: 30 daily, 12 weekly, 12 monthly") to a directory of dated
// backup files. Date math (week/month bucketing) is far less error-prone
// here than in bash, so backup.sh shells out to this instead of reimplementing
// it with `date`.
//
// Usage: node prune-backups.js <dir> <glob-prefix> <glob-suffix>
// A file matches if its name is `${prefix}YYYY-MM-DD${suffix}`.

const fs = require('fs');
const path = require('path');

const [, , dir, prefix, suffix] = process.argv;
if (!dir || !prefix || !suffix) {
  console.error('Usage: prune-backups.js <dir> <prefix> <suffix>');
  process.exit(1);
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;

function parseEntries() {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => {
      const dateStr = name.slice(prefix.length, name.length - suffix.length);
      if (!DATE_RE.test(dateStr)) return null;
      const date = new Date(`${dateStr}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return null;
      return { name, dateStr, date };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date); // newest first
}

function daysAgo(date, now) {
  return Math.floor((now - date) / 86400000);
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

const DAILY_DAYS = 30;
const WEEKLY_DAYS = 30 + 12 * 7; // 114
const MONTHLY_DAYS = 30 + 12 * 30; // 390, generous upper bound for 12 monthly reps

function main() {
  const entries = parseEntries();
  const now = new Date();
  const keep = new Set();
  const seenWeeks = new Set();
  const seenMonths = new Set();

  for (const entry of entries) {
    const age = daysAgo(entry.date, now);
    if (age <= DAILY_DAYS) {
      keep.add(entry.name);
      continue;
    }
    if (age <= WEEKLY_DAYS) {
      const wk = isoWeekKey(entry.date);
      if (!seenWeeks.has(wk)) {
        seenWeeks.add(wk);
        keep.add(entry.name); // newest-first order => newest backup of that week
      }
      continue;
    }
    if (age <= MONTHLY_DAYS) {
      const mk = monthKey(entry.date);
      if (!seenMonths.has(mk)) {
        seenMonths.add(mk);
        keep.add(entry.name);
      }
    }
    // older than MONTHLY_DAYS: never kept
  }

  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    fs.unlinkSync(path.join(dir, entry.name));
    console.log(`pruned ${entry.name}`);
  }
}

main();
