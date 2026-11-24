import {packager} from '@electron/packager';
import {cp, mkdir, rename, rm, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('此构建入口用于 Apple Silicon Mac。');
}
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../outputs');
const build = path.join(here, '.build');
const site = path.join(build, 'site');
const name = '数二真题练习';
const appId = 'org.math2practice.desktop';
const destination = path.join(out, name + '.app');
const page = path.join(out, '数二真题进度.html');

await stat(page).catch(() => { throw new Error('请先构建题库，生成 outputs/数二真题进度.html。'); });
await mkdir(site, {recursive:true});
await cp(page, path.join(site, path.basename(page)));
await cp(path.join(out, '练习资源'), path.join(site, '练习资源'), {recursive:true});
execFileSync('bash', [path.join(here, 'bridge/build.sh')], {stdio:'inherit'});

const electronVersion = '45.4.1';
const zipName = 'electron-v' + electronVersion + '-darwin-arm64.zip';
const zip = path.join(build, zipName);
const digest = 'd080c3b05a01bd16137f2c12ab9ebf083c577757fe846844ba325bafa8e8bdf4';
if (!await stat(zip).catch(() => null)) {
  const url = 'https://github.com/electron/electron/releases/download/v' + electronVersion + '/' + zipName;
  execFileSync('/usr/bin/curl', ['--fail','--location','--retry','2','--output',zip + '.part',url], {stdio:'inherit'});
  await rename(zip + '.part', zip);
}
if (execFileSync('/usr/bin/shasum', ['-a','256',zip], {encoding:'utf8'}).split(' ')[0] !== digest) {
  throw new Error('Electron 安装包校验失败，请删除 .build/' + zipName + ' 后重新构建。');
}

const [folder] = await packager({
  dir:path.join(here, 'app'), out:path.join(build, 'packaged'), overwrite:true,
  platform:'darwin', arch:'arm64', electronVersion, electronZipDir:build,
  name, appBundleId:appId, appCategoryType:'public.app-category.education',
  icon:path.join(here, 'icon.icns'), asar:true, prune:false,
  extraResource:[site, path.join(build, 'bridge')],
  extendInfo:{CFBundleDevelopmentRegion:'zh_CN', NSHumanReadableCopyright:'Math2 Practice contributors'}
});
const built = path.join(folder, name + '.app');
const licenses = path.join(built, 'Contents/Resources/licenses');
await mkdir(licenses, {recursive:true});
for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
  const source = path.join(folder, file);
  if (await stat(source).catch(() => null)) await cp(source, path.join(licenses, file));
}
execFileSync('/usr/bin/codesign', ['--force','--deep','--sign','-',built], {stdio:'inherit'});
execFileSync('/usr/bin/codesign', ['--verify','--deep','--strict',built]);
const old = path.join(build, 'previous.app');
if (await stat(destination).catch(() => null)) {
  const id = execFileSync('/usr/libexec/PlistBuddy', ['-c','Print CFBundleIdentifier',path.join(destination,'Contents/Info.plist')], {encoding:'utf8'}).trim();
  if (id !== appId) throw new Error('输出位置已有其他应用，已保留原文件。');
  await rm(old, {recursive:true,force:true});
  await rename(destination, old);
}
try {
  await rename(built, destination);
} catch (error) {
  if (await stat(old).catch(() => null)) await rename(old, destination);
  throw error;
}
await rm(old, {recursive:true,force:true});
console.log(destination);
