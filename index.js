#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXAMPLE_DIR = path.join(__dirname, 'example');
function main() {
  const args = process.argv.slice(2);
  let subscriptionsFile;

  if (args.length === 0) {
    subscriptionsFile = path.resolve('subscriptions.txt');
  } else if (args.includes('--help') || args.includes('-h')) {
    displayHelp();
    process.exit(0);
  } else if (args.includes('--create') || args.includes('-c')) {
    createExample();
    process.exit(0);
  } else {
    let inputPath = path.resolve(args[0]);
    if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
      subscriptionsFile = path.join(inputPath, 'subscriptions.txt');
    } else {
      subscriptionsFile = inputPath;
    }
  }

  if (!fs.existsSync(subscriptionsFile)) {
    console.error(`Error: subscriptions file not found at ${subscriptionsFile}.`);
    displayHelp();
    process.exit(1);
  }

  const baseDir = path.dirname(subscriptionsFile);
  processSubscriptions(subscriptionsFile, baseDir);
}

function displayHelp() {
  console.log(`
    Usage: ytsub [subscriptions.txt] [-t interval]

    Commands:
      ytsub                 Try to find subscriptions.txt in current directory
      ytsub <path>          Use a specific subscriptions file or directory containing one
      ytsub --help, -h      Show this help message
      ytsub --create, -c    Create an example subscriptions.txt

    Options:
      -t <interval>         Set a refresh interval in seconds (default: none)
  `);
}

function createExample() {
  const exampleFile = path.join(EXAMPLE_DIR, 'subscriptions.txt');
  const destinationFile = path.join(process.cwd(), 'subscriptions.txt');
  if (fs.existsSync(destinationFile)) {
    console.log('subscriptions.txt already exists, not overwriting.');
  } else {
    fs.copyFileSync(exampleFile, destinationFile);
    console.log('Created example subscriptions.txt to the current directory.');
  }
}

function runCommand (command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });

    child.on('error', (error) => {
      reject(`Error: ${error.message}`);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(`Process exited with code ${code}`);
      } else {
        resolve();
      }
    });
  });
}

function moveFile(oldPath, newPath) {
  return new Promise((resolve, reject) => {
    fs.rename(oldPath, newPath, (err) => {
      if (err) {
        reject(`Error moving file: ${err.message}`);
      } else {
        resolve();
      }
    });
  });
}

function parseTxtFile(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  const sections = [];
  let currentSection = null;

  // Identify sections and split content
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//') || trimmedLine.startsWith(';')) {
      continue;
    }
    if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
      currentSection = { sectionName: trimmedLine.slice(1, -1), content: [] };
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  }

  // Split front matter and body
  for (const section of sections) {
    const frontMatterIndex = section.content.findIndex(line => /^-{4,}$/.test(line.trim()));
    if (frontMatterIndex !== -1) {
      section.frontMatter = section.content.slice(0, frontMatterIndex);
      section.body = section.content.slice(frontMatterIndex + 1);
    } else {
      section.frontMatter = [];
      section.body = section.content;
    }
    delete section.content;
  }
  return sections;
}

function parseSubscriptions(filePath) {
  const sections = parseTxtFile(filePath);
  return sections.map(({ sectionName, frontMatter, body }) => {
    const args = [];
    const organize = {};
    let urls = [];

    for (const line of frontMatter) {
      if (line.startsWith('-organize ')) {
        const [, arg, key, value] = line.match(/^-(organize)\s+(.+?)\s*:\s*(.+)/) || [];
        const [, pattern, flags] = value.match(/^\/(.*)\/([gimsuy]*)$/) || [];
        try {
          if (!pattern) throw 'Invalid pattern!';
          organize[key] = new RegExp(pattern, flags);
        } catch (err) {
          console.error(`Invalid Regular Expression at [${sectionName}] ${line} ! ${err}`);
        }
      } else {
        args.push(line);
      }
    }

    urls = body;

    return { name: sectionName, args, organize, urls };
  });
}


async function downloadVideos(outputDir, url, args) {
  const archivePath = path.join(outputDir, '_archive.txt');
  try {
    await runCommand('yt-dlp', [
      '-P', outputDir,
      '--download-archive', archivePath,
      ...args,
      url
    ], outputDir);
    console.log(`Downloaded videos from ${url} to ${outputDir}`);
  } catch (error) {
    console.error(`Failed to download videos from ${url}: ${error}`);
  }
}

async function organizeVideos(outputDir, filters) {
  console.log('Organizing files', outputDir, filters);
  const files = fs.readdirSync(outputDir);
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    if (fs.lstatSync(filePath).isFile()) {
      for (const [subDir, regex] of Object.entries(filters)) {
        if (regex.test(file)) {
          const subDirPath = path.join(outputDir, subDir);
          fs.mkdirSync(subDirPath, { recursive: true });
          const newFilePath = path.join(subDirPath, file);
          await moveFile(filePath, newFilePath);
          console.log(`Moved ${file} to ${subDirPath}`);
          break;
        }
      }
    }
  }
}

async function processSubscriptions(subscriptionsFile, baseDir) {
  try {
    const subscriptions = parseSubscriptions(subscriptionsFile);
    console.log(subscriptions);
    for (const subscription of subscriptions) {
      const outputDir = path.join(baseDir, subscription.name);
      fs.mkdirSync(outputDir, { recursive: true });
      for (const url of subscription.urls) {
        await downloadVideos(outputDir, url, subscription.args);
      }
      await organizeVideos(outputDir, subscription.organize);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

main();
