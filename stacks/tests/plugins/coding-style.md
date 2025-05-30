- Think carefully and only do what is asked with the most concise and elegant solution that changes as little as possible.
- Generate only the files which have corresponding Output: directive. 
- Don't assume any other files besides Output: and Context: exist.
- Use ES6+ syntax with async/await and import/export.
- Don't use require() use import instead.

- Use `jest` for tests.
- import {jest} from '@jest/globals'
- Cleanup using `finally`. Don't use `catch` unless you are expecting an error.
- Don't use `sinon` or any other mocking library.
- Avoid `node-fetch` and use native `fetch` instead.
- IMPORTANT: Don't ever mock `fetch`, run mock web servers instead.
- IMPORTANT: Use only real Redis for testing. Don't mock it.
- Use `server.listen` without port or host to use a random port during tests.
- Don't check constructor equality like `.toBeInstanceOf(Array)` or `.toEqual(expect.any(Array))`. Just check the values.