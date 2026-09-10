// server/ 폴더(별도 Node 서버와 그 node_modules)를 앱 번들 대상에서 제외한다.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const serverDir = path.join(__dirname, 'server') + path.sep;

config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escapeRegExp(serverDir)}`),
];

module.exports = config;
