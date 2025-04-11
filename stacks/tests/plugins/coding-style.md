- Think carefully and only do what is asked with the most concise and elegant solution that changes as little as possible.
- Generate only the files which have corresponding Output: directive. 
- Don't assume any other files besides Output: and Context: exist.
- Use ES6+ syntax with async/await and import/export.

- Use `jest` for tests.
- Cleanup using `finally`. Don't use `catch` unless you are expecting an error.
- Don't use `sinon` or any other mocking library.
- Use real Redis for testing, don't ever mock Redis.