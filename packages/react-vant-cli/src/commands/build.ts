import execa from 'execa';
import chokidar from 'chokidar';
import { join, relative } from 'path';
import { remove, copy, readdirSync, existsSync } from 'fs-extra';
import { ora, consola, slimPath } from '../common/logger';
import {
  isAsset,
  isDemoDir,
  isDir,
  isScript,
  isStyle,
  isTestDir,
  setBuildTarget,
  setModuleEnv,
  setNodeEnv,
} from '../common';
import { clean } from './clean';
import { LIB_DIR, ES_DIR, SRC_DIR } from '../common/constant';
import { genStyleDepsMap } from '../compiler/gen-style-deps-map';
import { genComponentStyle } from '../compiler/gen-component-style';
import { genPackageEntry } from '../compiler/gen-package-entry';
import { genPackageStyle } from '../compiler/gen-package-style';
import { CSS_LANG } from '../common/css';
import { compileJsPath } from '../compiler/compile-js';
import { compilePackage } from '../compiler/compile-package';
import { compileStyle } from '../compiler/compile-style';
import { installDependencies } from '../common/manager';

async function compileFile(filePath: string) {
  if (isScript(filePath)) {
    return compileJsPath(filePath);
  }

  if (isStyle(filePath)) {
    return compileStyle(filePath);
  }

  if (isAsset(filePath)) {
    return Promise.resolve();
  }

  // return remove(filePath);
  return Promise.resolve();
}

async function compileDir(dir: string) {
  const files = readdirSync(dir);

  await Promise.all(
    files.map((filename) => {
      const filePath = join(dir, filename);

      if (isDemoDir(filePath) || isTestDir(filePath)) {
        return remove(filePath);
      }

      if (isDir(filePath)) {
        return compileDir(filePath);
      }

      return compileFile(filePath);
    }),
  );
}

async function copySourceCode() {
  await copy(SRC_DIR, ES_DIR);
  await copy(SRC_DIR, LIB_DIR);
}

async function buildPackageScriptEntry() {
  const esEntryFile = join(ES_DIR, 'index.js');
  const libEntryFile = join(LIB_DIR, 'index.js');

  genPackageEntry({
    outputPath: esEntryFile,
    pathResolver: (path: string) => `./${relative(SRC_DIR, path)}`,
  });

  await copy(esEntryFile, libEntryFile);
}

async function buildStyleEntry() {
  await genStyleDepsMap();
  genComponentStyle();
}

async function buildPackageStyleEntry() {
  const styleEntryFile = join(LIB_DIR, `index.${CSS_LANG}`);

  genPackageStyle({
    outputPath: styleEntryFile,
    pathResolver: (path: string) => path.replace(SRC_DIR, '.'),
  });
}

async function buildTypeDeclarations() {
  const tsConfig = join(process.cwd(), 'tsconfig.declaration.json');

  if (existsSync(tsConfig)) {
    await execa('tsc', ['-p', tsConfig]);
  }
}

async function buildESMOutputs() {
  setModuleEnv('esmodule');
  setBuildTarget('package');
  await compileDir(ES_DIR);
  // await compile({ targetPath: ES_DIR, watch: cmd.watch, type: 'esm' });
}

async function buildCJSOutputs() {
  setModuleEnv('commonjs');
  setBuildTarget('package');
  await compileDir(LIB_DIR);
  // await compile({ targetPath: LIB_DIR, watch: cmd.watch, type: 'cjs' });
}

async function buildBundledOutputs() {
  setModuleEnv('esmodule');
  await compilePackage(false);
  await compilePackage(true);
}

const tasks = [
  {
    text: 'Copy Source Code',
    task: copySourceCode,
  },
  {
    text: 'Build Package Script Entry',
    task: buildPackageScriptEntry,
  },
  {
    text: 'Build Component Style Entry',
    task: buildStyleEntry,
  },
  {
    text: 'Build Package Style Entry',
    task: buildPackageStyleEntry,
  },
  {
    text: 'Build Type Declarations',
    task: buildTypeDeclarations,
  },
  {
    text: 'Build ESModule Outputs',
    task: buildESMOutputs,
  },
  {
    text: 'Build CommonJS Outputs',
    task: buildCJSOutputs,
  },
  {
    text: 'Build Bundled Outputs',
    task: buildBundledOutputs,
  },
];

async function runBuildTasks() {
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < tasks.length; i++) {
    const { task, text } = tasks[i];
    const spinner = ora(text).start();

    try {
      /* eslint-disable no-await-in-loop */
      await task();
      spinner.succeed(text);
    } catch (err) {
      spinner.fail(text);
      console.log(err);
      throw err;
    }
  }

  consola.success('Compile successfully');
}

function watchFileChange() {
  consola.info('Watching file changes...');

  chokidar.watch(SRC_DIR).on('change', async (path) => {
    if (isDemoDir(path) || isTestDir(path)) {
      return;
    }

    const spinner = ora('File changed, start compilation...').start();
    const esPath = path.replace(SRC_DIR, ES_DIR);
    const libPath = path.replace(SRC_DIR, LIB_DIR);

    try {
      await copy(path, esPath);
      await copy(path, libPath);
      await compileFile(esPath);
      await compileFile(libPath);
      await genStyleDepsMap();
      genComponentStyle({ cache: false });
      spinner.succeed(`Compiled: ${slimPath(path)}`);
    } catch (err) {
      spinner.fail(`Compile failed: ${path}`);
      console.log(err);
    }
  });
}

export async function build(cmd: { watch?: boolean } = {}) {
  setNodeEnv('production');

  try {
    await clean();
    await installDependencies();
    await runBuildTasks();

    if (cmd.watch) {
      watchFileChange();
    }
  } catch (err) {
    consola.error('Build failed');
    process.exit(1);
  }
}
