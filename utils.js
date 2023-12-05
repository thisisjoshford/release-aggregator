require('dotenv').config();
const fs = require('fs').promises;
const axios = require('axios');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { config } = require('./config');

const OAuth2 = google.auth.OAuth2;

async function createTransporter() {
  try {
    const oauth2Client = new OAuth2(
      process.env.CLIENT_ID,
      process.env.ACCESS_CODE,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN,
    });

    const accessToken = await new Promise((resolve, reject) => {
      oauth2Client.getAccessToken((err, token) => {
        if (err) {
          console.log('*ERR: ', err);
          reject();
        }
        resolve(token);
      });
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL,
        accessToken,
        clientId: 'process.env.CLIENT_ID',
        clientSecret: process.env.ACCESS_CODE,
        refreshToken: process.env.REFRESH_TOKEN,
      },
    });
    return transporter;
  } catch (err) {
    return err;
  }
}



async function getIssues(owner, repo, startDate, endDate) {
  const params = {
    state: 'all',
    sort: 'created',
    direction: 'desc', // ascending order to start from the earliest issues
    per_page: 100,
  };

  let response = await axios.get(
    config.GITHUB_ISSUES_API_URL.replace('{owner}', owner).replace(
      '{repo}',
      repo
    ),
    { headers: config.HEADERS, params: params }
  );
  let issues = [];
  if (response.data.length > 0) {
    response.data.forEach((issue) => {
      if (
        !issue.pull_request &&
        new Date(issue.created_at) >= startDate &&
        new Date(issue.created_at) <= endDate
      ) {
        issues.push(issue);
      }
    });
  }
  return issues;
}

async function getReleases(owner, repo, startDate, endDate) {
  let response = await axios.get(
    config.GITHUB_RELEASE_API_URL.replace('{owner}', owner).replace(
      '{repo}',
      repo
    ),
    { headers: config.HEADERS }
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
        config.GITHUB_PR_API_URL.replace('{owner}', owner).replace(
          '{repo}',
          repo
        ),
        { headers: config.HEADERS, params }
      );

      if (response.data.length > 0) {
        const mergedPRs = response.data.filter(
          (pr) =>
            pr.merged_at &&
            new Date(pr.merged_at) >= new Date(startDate) &&
            new Date(pr.merged_at) <= new Date(endDate)
        );
        process.stdout.write(` ✅ - ${repo} \n`);
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

function formatPRs(issues) {
  let prList = [];
  issues.forEach((pr) => {
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

function formatIssues(issues) {
  let issueList = [];
  issues.forEach((issue) => {
    issue.created_at = issue.created_at.split('T')[0];
    if (issue.title.length > 40) {
      issue.title = issue.title.substring(0, 50) + '...';
    }
    issueList.push({
      created_at: issue.created_at,
      num: `[${issue.number}](${issue.html_url})`,
      title: `[${issue.title}](${issue.html_url})`,
    });
    return;
  });
  return issueList;
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

function generateIssuesMarkdownDoc(repos, dates) {
  let markdownDoc = `# NEAR Merged Pull Requests for ${dates.markdownDate.monthSpelled} ${dates.markdownDate.year}\n\n`;

  // Generate Table of Contents
  markdownDoc += `## Table of Contents\n\n`;
  repos.forEach((repo) => {
    markdownDoc += `- [${repo.repo.toUpperCase()}](#${repo.repo})\n`;
  });

  markdownDoc += `\n-------------------------------------------------\n`;

  // Generate PR tables
  repos.forEach((repo) => {
    let markdownTable = generateMarkdownTable(repo.issueList);
    markdownDoc += `\n## ${repo.repo.toUpperCase()}\n\n` + markdownTable;
  });
  return markdownDoc;
}

function generatePRsMarkdownDoc(repos, dates) {
  let markdownDoc = `# NEAR Merged Pull Requests for ${dates.markdownDate.monthSpelled} ${dates.markdownDate.year}\n\n`;

  // Generate Table of Contents
  markdownDoc += `## Table of Contents\n\n`;
  repos.forEach((repo) => {
    markdownDoc += `- [${repo.repo.toUpperCase()}](#${repo.repo.toLowerCase()}) \n`;
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
  console.log(` 📝 Report created @ ${filename}\n`);
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
  formatIssues,
  createTransporter,
  getIssues,
  generateMarkdownTable,
  generateIssuesMarkdownDoc,
  generatePRsMarkdownDoc,
  writeMarkdownFile,
  getReleases,
  getMergedPRs,
  getDates,
  formatPRs,
  countPRs,
};
