const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');

// Function to execute shell commands and show progress
const runCommand = (command, args, cwd) => {
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
};

// Function to move files without changing modified dates
const moveFile = (oldPath, newPath) => {
  return new Promise((resolve, reject) => {
    fs.rename(oldPath, newPath, (err) => {
      if (err) {
        reject(`Error moving file: ${err.message}`);
      } else {
        resolve();
      }
    });
  });
};

// Function to parse the subscriptions file
const parseSubscriptions = (filePath) => {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  let baseDir = '';
  const subscriptions = [];
  let currentSubscription = null;

  lines.forEach((line) => {
    line = line.trim();
    if (line.startsWith('base_dir=')) {
      baseDir = line.split('=')[1].replace('~', os.homedir());
    } else if (line.startsWith('[') && line.endsWith(']')) {
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

  return { baseDir, subscriptions };
};

// Function to download videos using yt-dlp with archive support
const downloadVideos = async (outputDir, url) => {
  const archivePath = path.join(outputDir, 'archive.txt');
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
};

// Function to organize downloaded videos
const organizeVideos = async (outputDir, filters) => {
  console.log('Organizing Videos...', outputDir, filters);
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
};

// Main function to process subscriptions
const processSubscriptions = async () => {
  try {
    const { baseDir, subscriptions } = parseSubscriptions('subscriptions.txt');
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
};

// Run the script immediately and then every 24 hours
processSubscriptions();
// setInterval(processSubscriptions, 24 * 60 * 60 * 1000);
