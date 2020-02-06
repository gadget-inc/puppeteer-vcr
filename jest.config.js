module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist"],
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"]
};
