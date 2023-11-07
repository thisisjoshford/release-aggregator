require('dotenv').config();
const fs = require('fs').promises;
const axios = require('axios');

const GITHUB_RELEASE_API_URL =
  'https://api.github.com/repos/{owner}/{repo}/releases';
const GITHUB_PR_API_URL = 'https://api.github.com/repos/{owner}/{repo}/pulls';
const TOKEN = process.env.GITHUB_TOKEN;
const HEADERS = {
  Authorization: `token ${TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
};

async function getReleases(owner, repo, startDate, endDate) {
  let response = await axios.get(
    GITHUB_RELEASE_API_URL.replace('{owner}', owner).replace('{repo}', repo),
    { headers: HEADERS }
  );
  let releases = [];
  if (response.data.length > 0) {
    response.data.forEach((release) => {
      if (
        new Date(release.published_at) >= startDate &&
        new Date(release.published_at) <= endDate
      ) {
        releases.push(release);
      }
    });
  }
  return releases;
}

async function getMergedPRs(owner, repo, startDate, endDate) {
  const baseBranches = ['main', 'master'];
  try {
    for (const base of baseBranches) {
      const params = {
        state: 'closed',
        base: base,
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      };

      let response = await axios.get(
        GITHUB_PR_API_URL.replace('{owner}', owner).replace('{repo}', repo),
        { headers: HEADERS, params }
      );

      if (response.data.length > 0) {
        const mergedPRs = response.data.filter(
          (pr) =>
            pr.merged_at &&
            new Date(pr.merged_at) >= new Date(startDate) &&
            new Date(pr.merged_at) <= new Date(endDate)
        );
        console.log(` ✅ - ${repo} `);
        return mergedPRs;
      }
    }
  } catch (error) {
    console.error(
      'Error fetching PRs:',
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

function formatPRs(prs) {
  let prList = [];
  prs.forEach((pr) => {
    pr.merged_at = pr.merged_at.split('T')[0];
    if (pr.title.length > 40) {
      pr.title = pr.title.substring(0, 50) + '...';
    }
    prList.push({
      merged_at: pr.merged_at,
      num: `[${pr.number}](${pr.html_url})`,
      title: `[${pr.title}](${pr.html_url})`,
    });
    return;
  });
  return prList;
}
function generateMarkdownTable(data) {
  if (!data.length) {
    return '# NEAR Dev Report: \n\nNo data available.';
  }
  const headers = Object.keys(data[0]);

  let markdownTable = '';

  // Generate headers
  markdownTable += `| ${headers.join(' | ')} |\n`;
  // Generate separators
  markdownTable += `| ${headers.map(() => '---').join(' | ')} |\n`;

  // Generate table rows
  for (const item of data) {
    const row = headers.map((header) => item[header]).join(' | ');
    markdownTable += `| ${row} |\n`;
  }
  return markdownTable;
}

function generatePRsMarkdownDoc(repos, dates) {
  let markdownDoc = `# NEAR Merged Pull Requests for ${dates.markdownDate.monthSpelled} ${dates.markdownDate.year}\n\n`;

  // Generate Table of Contents
  markdownDoc += `## Table of Contents\n\n`;
  repos.forEach((repo) => {
    markdownDoc += `- [${repo.repo.toUpperCase()}](#${repo.repo})\n`;
  });

  markdownDoc += `\n-------------------------------------------------\n`;

  // Generate PR tables
  repos.forEach((repo) => {
    let markdownTable = generateMarkdownTable(repo.prList);
    markdownDoc += `\n## ${repo.repo.toUpperCase()}\n\n` + markdownTable;
  });
  return markdownDoc;
}

async function writeMarkdownFile(filename, content) {
  await fs.writeFile(filename, content, 'utf8');
  console.log(` 📝 Report created @ ${filename}\n\n`);
}

function getDates(month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const monthSpelled = startDate.toLocaleString('default', { month: 'long' });
  const twoDigitMonth = month < 10 ? `0${month}` : month;
  const markdownDate = { monthSpelled, year };

  return { startDate, endDate, markdownDate, monthSpelled, twoDigitMonth };
}

function countPRs(repos) {
  let totalPRs = 0;
  repos.forEach((repo) => {
    totalPRs += repo.prList.length;
  });
  return totalPRs;
}

module.exports = {
  generateMarkdownTable,
  generatePRsMarkdownDoc,
  writeMarkdownFile,
  getReleases,
  getMergedPRs,
  getDates,
  formatPRs,
  countPRs,
};
