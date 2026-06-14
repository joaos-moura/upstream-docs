import chalk from 'chalk'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { scaffoldInto } from '../lib/scaffold.js'
import { writeMcpSettings } from '../lib/settings.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const TEMPLATES = join(__dirname, '../../templates')

export async function upgradeCommand() {
  const target = process.cwd()
  console.log(chalk.blue('upstream:'), 'upgrading skills and hook in', target)

  try {
    await scaffoldInto(target, TEMPLATES)
    writeMcpSettings(target)
    console.log(chalk.green('✓ upstream upgraded'))
    console.log('')
    console.log('Review the diff and commit:')
    console.log('  git diff .claude/')
    console.log('  git add .claude/')
    console.log('  git commit -m "chore: upgrade upstream plugin"')
  } catch (err) {
    console.error(chalk.red('upstream upgrade failed:'), err.message)
    process.exit(1)
  }
}
