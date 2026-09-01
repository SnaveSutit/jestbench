import { expect } from '@jest/globals'

import { matcherImplementations } from './matcher-impls'
import './matcher-types'

expect.extend(matcherImplementations)

export { matcherImplementations }
