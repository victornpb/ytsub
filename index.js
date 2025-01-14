const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');

const EXAMPLE_DIR = path.join(__dirname, "example");

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (args.length === 0 || args.includes("--help")) {
    displayHelp();
    process.exit(0);
  } else if (command === "start") {
    if (!args[1]) {
      console.error("Error: Missing subscriptions file.");
      displayHelp();
      process.exit(1);
    }
    const subscriptionsFile = path.resolve(args[1]);
    const baseDir = path.dirname(subscriptionsFile);
    const interval = args.includes('-t') ? parseInt(args[args.indexOf('-t') + 1]) * 1000 : null;
    processSubscriptions(subscriptionsFile, baseDir);
    if (interval) {
      setInterval(() => processSubscriptions(subscriptionsFile, baseDir), interval);
    }
  } else if (command === "create") {
    createExample();
    process.exit(0);
  } else {
    console.error("Unknown command:", command);
    displayHelp();
    process.exit(1);
  }
}

function displayHelp() {
  console.log(`
    Usage: ytsub <command> <subscriptions.txt> [-t interval]

    Commands:
      start <subscriptions.txt> [-t interval]  Start processing the given subscriptions file with an optional interval (default: 24h)
      create                                   Create an example subscriptions.txt
      --help                                   Show this help message
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
  const lines = data.split('
    ');
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
