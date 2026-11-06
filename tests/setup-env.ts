import { TEST_APP_URL } from "./env";
process.env.DATABASE_URL = TEST_APP_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.STORAGE_LOCAL_DIR ??= "./var/test-storage";
