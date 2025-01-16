#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const util = require('util');
const { spawn } = require('child_process');

const EXAMPLE_DIR = path.join(__dirname, 'example');

let isRunning = false;


function parseCliArgs(args) {
  const cliArgs = {
    help: args.includes('--help') || args.includes('-h'),
    dry: args.includes('--dry'),
    create: args.includes('--create') || args.includes('-c'),
    interval: null,
    subscriptionsFile: null,
  };

  const intervalIndex = args.findIndex(arg => arg === '-t');
  if (intervalIndex !== -1 && args[intervalIndex + 1]) {
    cliArgs.interval = parseInt(args[intervalIndex + 1], 10) * 1000;
    if (isNaN(cliArgs.interval)) {
      console.error(`Invalid interval value. Please provide a valid number. ${args[intervalIndex]} ${args[intervalIndex + 1]}`);
      process.exit(1);
    }
  }

  const inputPath = args[0] ? path.resolve(args[0]) : path.resolve('subscriptions.txt');
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
    cliArgs.subscriptionsFile = path.join(inputPath, 'subscriptions.txt');
  } else {
    cliArgs.subscriptionsFile = inputPath;
  }

  return cliArgs;
}

async function main() {
  const args = process.argv.slice(2);
  const cliArgs = parseCliArgs(args);

  if (cliArgs.help) {
    displayHelp();
    process.exit(0);
  }

  if (cliArgs.create) {
    createExample();
    process.exit(0);
  }

  if (!fs.existsSync(cliArgs.subscriptionsFile)) {
    console.error(`Error: subscriptions file not found at ${cliArgs.subscriptionsFile}.`);
    displayHelp();
    process.exit(1);
  }

  const baseDir = path.dirname(cliArgs.subscriptionsFile);

  if (cliArgs.interval) {
    console.log(`Running with interval: ${secondsToDhms(cliArgs.interval / 1000)}.`);
    setInterval(async () => {
      if (isRunning) return console.log('Already running skipping interval. (consider not running this frequent)');
      await processSubscriptions(cliArgs.subscriptionsFile, baseDir, cliArgs);
      console.log(`Next run in ${secondsToDhms(cliArgs.interval / 1000)}...`);
    }, cliArgs.interval);  
  }

  await processSubscriptions(cliArgs.subscriptionsFile, baseDir, cliArgs);
}


function displayHelp() {
  console.log(`
    Usage: ytsub [subscriptions.txt] [options]

    Commands:
      ytsub                 Try to find subscriptions.txt in current directory
      ytsub <path>          Use a specific subscriptions file or directory containing one
      ytsub --help, -h      Show this help message
      ytsub --create, -c    Create an example subscriptions.txt

    Options:
      -t <interval>         Set a refresh interval in seconds (default: none)
      --dry                 Parse the subscriptions.txt file and don't call yt-dlp
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


function parseTxtFile(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  const sections = [];
  const preSection = [];
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
    } else {
      preSection.push(line);
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

  return { preSection, sections };
}


function parseSubscriptions(filePath) {
  const { preSection, sections } = parseTxtFile(filePath);

  const globalArgs = [];
  const globalOrganize = {};
  for (const line of preSection) {
    if (line.startsWith('-organize ')) {
      const [, arg, key, value] = line.match(/^-(organize)\s+["']?(.+?)["']?\s*:\s*(.+)/) || [];
      const [, pattern, flags] = value.match(/^\/(.*)\/([gimsuy]*)$/) || [];
      try {
        if (!pattern) throw 'Invalid pattern!';
        globalOrganize[key] = new RegExp(pattern, flags);
      } catch (err) {
        console.error(`Invalid Regular Expression before Sections Line: "${line}" ! Error: ${err}`);
      }
    } else {
      const args = line.match(/(?:[^\s"]+|"[^"]*")+/g).map(arg => arg.replace(/"/g, ''));
      globalArgs.push(...args);
    }
  }

  const subscriptions = sections.map(({ sectionName, frontMatter, body }) => {
    const args = [];
    const organize = {};
    for (const line of frontMatter) {
      if (line.startsWith('-organize ')) {
        const [, arg, key, value] = line.match(/^-(organize)\s+["']?(.+?)["']?\s*:\s*(.+)/) || [];
        const [, pattern, flags] = value.match(/^\/(.*)\/([gimsuy]*)$/) || [];
        try {
          if (!pattern) throw 'Invalid pattern!';
          organize[key] = new RegExp(pattern, flags);
        } catch (err) {
          console.error(`Invalid Regular Expression at [${sectionName}] "${line}" ! Error: ${err}`);
        }
      } else {
        const argsp = line.match(/(?:[^\s"]+|"[^"]*")+/g).map(arg => arg.replace(/"/g, ''));
        args.push(...argsp);
      }
    }
    return { name: sectionName, args, organize, urls: body };
  });

  return {
    globalArgs,
    globalOrganize,
    subscriptions,
  };
}


async function processSubscriptions(subscriptionsFile, baseDir, cliArgs) {
  isRunning = true;
  try {
    const subsObject = parseSubscriptions(subscriptionsFile);
    const { globalArgs, globalOrganize, subscriptions } = subsObject;
    console.log(util.inspect(subsObject, false, null, true));
    if (cliArgs.dry) return;

    for (const subscription of subscriptions) {
      const outputDir = path.join(baseDir, subscription.name);
      fs.mkdirSync(outputDir, { recursive: true });
      for (const url of subscription.urls) {
        await downloadVideos(outputDir, url, [...globalArgs, ...subscription.args]);
      }
      await organizeVideos(outputDir, { ...globalOrganize, ...subscription.organize });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
  finally{
    isRunning = false;
  }
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


function runCommand(command, args, cwd) {
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


async function organizeVideos(outputDir, filters) {
  console.log('Organizing files', outputDir, filters);
  const files = fs.readdirSync(outputDir);
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    if (file === '_archive.txt' || !/\.(mp4|m4v|mkv|webm|description|json|srt|vtt|ass|lrc)$/.test(file)) continue;
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


function secondsToDhms(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    d > 0 ? `${d}d` : null,
    h > 0 ? `${h}h` : null,
    m > 0 ? `${m}m` : null,
    `${s}s`
  ].filter(Boolean).join(' ');
}


main();
