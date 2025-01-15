#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXAMPLE_DIR = path.join(__dirname, "example");

function main() {
  const args = process.argv.slice(2);
  let subscriptionsFile = "subscriptions.txt";

  if (args.length === 0) {
    subscriptionsFile = path.resolve("subscriptions.txt");
  } else if (args.includes("--help") || args.includes("-h")) {
    displayHelp();
    process.exit(0);
  } else if (args.includes("-create")) {
    createExample();
    process.exit(0);
  } else {
    subscriptionsFile = path.resolve(args[0]);
  }

  if (!fs.existsSync(subscriptionsFile)) {
    console.error("Error: subscriptions file not found.");
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
      ytsub <path>          Use a specific subscriptions file
      ytsub --help, -h      Show this help message
      ytsub -create         Create an example subscriptions.txt

    Options:
      -t <interval>         Set a refresh interval in seconds (default: none)
  `);
}

function createExample() {
  const exampleFile = path.join(EXAMPLE_DIR, "subscriptions.txt");
  const destinationFile = path.join(process.cwd(), "subscriptions.txt");
  if (fs.existsSync(destinationFile)) {
    console.log("subscriptions.txt already exists, not overwriting.");
  } else {
    fs.copyFileSync(exampleFile, destinationFile);
    console.log("Created example subscriptions.txt to the current directory.");
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

function parseSubscriptions(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  const subscriptions = [];
  let currentSubscription = null;

  lines.forEach((line) => {
    line = line.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      if (currentSubscription) {
        subscriptions.push(currentSubscription);
      }
      currentSubscription = {
        name: line.slice(1, -1),
        filters: {},
        urls: [],
      };
    } else if (line.startsWith('-') && line.includes('=')) {
      const [key, value] = line.split('=');
      const match = value.match(/^\/(.*)\/([gimsuy]*)$/);
      if (match) {
        const [, pattern, flags] = match;
        currentSubscription.filters[key.slice(1)] = new RegExp(pattern, flags);
      }
    } else if (line.startsWith('http')) {
      currentSubscription.urls.push(line);
    }
  });

  if (currentSubscription) {
    subscriptions.push(currentSubscription);
  }

  return { subscriptions };
}

async function downloadVideos(outputDir, url){
  const archivePath = path.join(outputDir, '_archive.txt');
  try {
    await runCommand('yt-dlp', [
      '-P', outputDir,
      '--download-archive', archivePath,
      url
    ], outputDir);
    console.log(`Downloaded videos from ${url} to ${outputDir}`);
  } catch (error) {
    console.error(`Failed to download videos from ${url}: ${error}`);
  }
}

async function organizeVideos(outputDir, filters){
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

async function processSubscriptions(subscriptionsFile, baseDir){
  try {
    const { subscriptions } = parseSubscriptions(subscriptionsFile);
    for (const subscription of subscriptions) {
      const outputDir = path.join(baseDir, subscription.name);
      fs.mkdirSync(outputDir, { recursive: true });
      for (const url of subscription.urls) {
        await downloadVideos(outputDir, url);
      }
      await organizeVideos(outputDir, subscription.filters);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

main();
