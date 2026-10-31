process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYMENTS_PROVIDER = "mock";
process.env.BILLING_PROVIDER = "mock";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.EMAIL_PROVIDER = "mock";
process.env.BANK_PROVIDER = "mock";
delete process.env.OPENAI_API_KEY;
