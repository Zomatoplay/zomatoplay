import type { DepositNetworkId } from "@/types";
import type { AdminDeposit, AdminDepositStatus } from "@/types/admin";

/**
 * Mock deposit ledger.
 *
 * There is no blockchain connectivity. `txHash` and `confirmations` are static
 * sample values, not observed chain state.
 *
 * INTEGRATION POINT: a deposit service with per-user addresses and a chain
 * watcher would own these records and drive the status transitions
 * pending → detected → confirming → confirmed → credited.
 */

interface DepositSeed {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  amountUsdt: number;
  network: DepositNetworkId;
  walletAddress: string;
  txHash: string;
  createdAt: string;
  status: AdminDepositStatus;
  confirmations?: { current: number; required: number };
  creditedAt?: string | null;
  failureReason?: string;
}

const REQUIRED_CONFIRMATIONS: Record<DepositNetworkId, number> = {
  trc20: 20,
  erc20: 12,
  bep20: 15,
  polygon: 128,
};

function deposit(seed: DepositSeed): AdminDeposit {
  const required = REQUIRED_CONFIRMATIONS[seed.network];
  const settled = seed.status === "credited" || seed.status === "confirmed";
  return {
    id: seed.id,
    userId: seed.userId,
    userName: seed.userName,
    userDisplayId: seed.userDisplayId,
    // The sample rows predate the chain integration and are all attributed,
    // so they stand in for deposits an operator has already assigned.
    assignedAt: seed.createdAt,
    assignedBy: null,
    amountUsdt: seed.amountUsdt,
    network: seed.network,
    chain: "tron",
    chainNetwork: "shasta",
    tokenContract: null,
    tokenSymbol: "USDT",
    senderAddress: null,
    walletAddress: seed.walletAddress,
    txHash: seed.txHash,
    blockNumber: null,
    blockTimestamp: null,
    createdAt: seed.createdAt,
    detectedAt: seed.createdAt,
    confirmedAt: settled ? seed.createdAt : null,
    creditedAt: seed.creditedAt ?? null,
    confirmations:
      seed.confirmations ?? { current: settled ? required : 0, required },
    status: seed.status,
    verification: settled ? "verified" : "unverified",
    failureReason: seed.failureReason,
  };
}

export const adminDeposits: AdminDeposit[] = [
  deposit({
    id: "DEP-90241",
    userId: "usr_0a94e6",
    userName: "Divya Pandey",
    userDisplayId: "NT-4820216",
    amountUsdt: 500,
    network: "trc20",
    walletAddress: "THk3bV6nM9pR5xJ2wL8dW1cS4fY7gT0aCe",
    txHash: "9f2c41ab77de0356b18c94ef2a5d0c7318bb4e6f92a1c0d5837e4b62af108d3c1",
    createdAt: "2026-08-09T08:41:00.000Z",
    status: "confirming",
    confirmations: { current: 7, required: 20 },
  }),
  deposit({
    id: "DEP-90240",
    userId: "usr_770b41",
    userName: "Kavya Iyer",
    userDisplayId: "NT-4820206",
    amountUsdt: 250,
    network: "bep20",
    walletAddress: "TDh5wQ2nR8kM1pV4bX7jL3cF9yS6gT0aNu",
    txHash: "0x64ba9e17c30d582f7a41e0b96d3c8f25041ab7de6c92f38055e7a1c4b0d29863",
    createdAt: "2026-08-09T08:12:00.000Z",
    status: "detected",
    confirmations: { current: 1, required: 15 },
  }),
  deposit({
    id: "DEP-90239",
    userId: "usr_d5107a",
    userName: "Ishita Banerjee",
    userDisplayId: "NT-4820202",
    amountUsdt: 250,
    network: "trc20",
    walletAddress: "TGm4pR7vC1nX8kB3jW6dL9hF2yS5gQ0aTu",
    txHash: "1a8d73c05be942f16307ac8be2d514f907c3b6a1049e8d27f5b03ca61e982740",
    createdAt: "2026-08-08T19:04:00.000Z",
    status: "confirmed",
  }),
  deposit({
    id: "DEP-90238",
    userId: "usr_31e7b0",
    userName: "Yash Chauhan",
    userDisplayId: "NT-4820213",
    amountUsdt: 100,
    network: "polygon",
    walletAddress: "TQw6kB9nM3vP1xR8jL2dS5hC7fY4gT0aZi",
    txHash: "0xa1c7f30596bd28e4071ca835f6d90b24e8137af0c6529d84b3e0176ac95d2830",
    createdAt: "2026-08-08T16:38:00.000Z",
    status: "credited",
    creditedAt: "2026-08-08T16:52:00.000Z",
  }),
  deposit({
    id: "DEP-90237",
    userId: "usr_b8a615",
    userName: "Anjali Dubey",
    userDisplayId: "NT-4820222",
    amountUsdt: 350,
    network: "trc20",
    walletAddress: "TKv9bJ4nM1pR6xW2cL7dS3hF5yQ8gT0aZi",
    txHash: "6c04b91ae7328d05f14b93c60ad728e5109f3b47c826a0d1e59374bf20c8a613",
    createdAt: "2026-08-07T13:21:00.000Z",
    status: "credited",
    creditedAt: "2026-08-07T13:44:00.000Z",
  }),
  deposit({
    id: "DEP-90236",
    userId: "usr_3a72fc",
    userName: "Ananya Rao",
    userDisplayId: "NT-4820198",
    amountUsdt: 8000,
    network: "erc20",
    walletAddress: "TJp7fH4wR9nK2mB5vL8dS1cX6yQ3gA0tNe",
    txHash: "0xf03a72c9e18b45d60927ac31be5f08d472a1c96305be8f2d740a1cb385e9026f",
    createdAt: "2026-08-07T09:57:00.000Z",
    status: "credited",
    creditedAt: "2026-08-07T10:29:00.000Z",
  }),
  deposit({
    id: "DEP-90235",
    userId: "usr_e50f97",
    userName: "Zoya Ansari",
    userDisplayId: "NT-4820224",
    amountUsdt: 600,
    network: "trc20",
    walletAddress: "TPd1nK8mV3bR9pX6jW4cL2hS7fY5gQ0aTu",
    txHash: "b520d7f18c6a390e4271bd05fa93c8e610347bf29ad0c85e1936b74a0cf28d51",
    createdAt: "2026-08-06T21:14:00.000Z",
    status: "credited",
    creditedAt: "2026-08-06T21:37:00.000Z",
  }),
  deposit({
    id: "DEP-90234",
    userId: "usr_86ba07",
    userName: "Tanvi Shah",
    userDisplayId: "NT-4820208",
    amountUsdt: 600,
    network: "bep20",
    walletAddress: "TNb7cJ1mL4vX9pK6nR3dW8hS5fQ2gT0aYi",
    txHash: "0x2d94b6ce07138af5209c4be31d670a8f5142cb9037e6d08a1f3b52c7e94d0186",
    createdAt: "2026-08-06T11:03:00.000Z",
    status: "credited",
    creditedAt: "2026-08-06T11:19:00.000Z",
  }),
  deposit({
    id: "DEP-90233",
    userId: "usr_dd4b70",
    userName: "Sanya Kapoor",
    userDisplayId: "NT-4820218",
    amountUsdt: 200,
    network: "trc20",
    walletAddress: "TWb4jR9nK6mV2pX5dL8wS1hC7fY3gQ0aTi",
    txHash: "e7318b0c94ad25f6103a7be82c5d9407f61b3ac0928de154b70a3c68df015927",
    createdAt: "2026-08-05T18:46:00.000Z",
    status: "failed",
    failureReason:
      "Sent on a network the address does not support. Funds were not received.",
  }),
  deposit({
    id: "DEP-90232",
    userId: "usr_4c8930",
    userName: "Devansh Gupta",
    userDisplayId: "NT-4820203",
    amountUsdt: 3000,
    network: "trc20",
    walletAddress: "TKc9nB4mV7pS2xL5jR8dW1hY6fQ3gT0aCe",
    txHash: "5b91c74e0a3d826f107b4ce9250fa8b3d641970ce825ab30f17c4b06e93d2851",
    createdAt: "2026-08-05T07:29:00.000Z",
    status: "credited",
    creditedAt: "2026-08-05T07:51:00.000Z",
  }),
  deposit({
    id: "DEP-90231",
    userId: "usr_59d1ca",
    userName: "Lakshmi Krishnan",
    userDisplayId: "NT-4820212",
    amountUsdt: 2500,
    network: "erc20",
    walletAddress: "0x5aF9c31Bd74E026a8F1b95C4d0E73A62b8c04915",
    txHash: "0x81c3a70df5296be40147ac83b6d02f95e3417ab0c96d28f5031be7a4c80d5f26",
    createdAt: "2026-08-04T14:52:00.000Z",
    status: "credited",
    creditedAt: "2026-08-04T15:31:00.000Z",
  }),
  deposit({
    id: "DEP-90230",
    userId: "usr_2c5f19",
    userName: "Rahul Mehta",
    userDisplayId: "NT-4820207",
    amountUsdt: 1500,
    network: "trc20",
    walletAddress: "TPz3xM6vK9nR4mB1jW8dS5hL2fY7gQ0aCe",
    txHash: "c40a8371be05d29f6148ac07b3e5920df716c8a4053be29017da4b6c8ef03152",
    createdAt: "2026-08-03T10:18:00.000Z",
    status: "credited",
    creditedAt: "2026-08-03T10:40:00.000Z",
  }),
  deposit({
    id: "DEP-90229",
    userId: "usr_20f5c3",
    userName: "Harsh Vardhan",
    userDisplayId: "NT-4820221",
    amountUsdt: 800,
    network: "bep20",
    walletAddress: "TGf6cM2nK9vB5pR7xJ1dW3hL8yS4gQ0aTe",
    txHash: "0x9e2c1478bd05a3f6207ce4b91d380a75f4126cb90d3ae8517b02c9f6a4d38150",
    createdAt: "2026-08-02T20:07:00.000Z",
    status: "credited",
    creditedAt: "2026-08-02T20:22:00.000Z",
  }),
  deposit({
    id: "DEP-90228",
    userId: "usr_e93028",
    userName: "Aditya Nair",
    userDisplayId: "NT-4820205",
    amountUsdt: 12000,
    network: "erc20",
    walletAddress: "0x9dC4a71E86b3F250c9A7d14B0e8F6532aD90b1c4",
    txHash: "0x37b0da9c8145e26f309ac71b5d802f64e19538ab0c74d2e6f105b3a97cd28046",
    createdAt: "2026-08-01T09:36:00.000Z",
    status: "credited",
    creditedAt: "2026-08-01T10:14:00.000Z",
  }),
  deposit({
    id: "DEP-90227",
    userId: "usr_2f90bd",
    userName: "Priya Menon",
    userDisplayId: "NT-4820194",
    amountUsdt: 1100,
    network: "trc20",
    walletAddress: "TXk4mQ7vL9pR2sD5nB8jH3wY6tC1gF0aVe",
    txHash: "a63f81b7c05de29417ac0b83d6510f92e7418ba3c05d29e6f7130ab4c8d2e095",
    createdAt: "2026-07-30T15:41:00.000Z",
    status: "credited",
    creditedAt: "2026-07-30T16:03:00.000Z",
  }),
  deposit({
    id: "DEP-90226",
    userId: "usr_ce2158",
    userName: "Farhan Qureshi",
    userDisplayId: "NT-4820215",
    amountUsdt: 900,
    network: "trc20",
    walletAddress: "TXt5nR2mK8vB4pW1jL7dC9hS6fY3gQ0aNu",
    txHash: "d18c05a37be946f2017ac4b8e35d09f6412bc7a0983de5164b0a72c9f8e03d15",
    createdAt: "2026-07-29T12:25:00.000Z",
    status: "credited",
    creditedAt: "2026-07-29T12:48:00.000Z",
  }),
  deposit({
    id: "DEP-90225",
    userId: "usr_1d7042",
    userName: "Suresh Balan",
    userDisplayId: "NT-4820223",
    amountUsdt: 4000,
    network: "erc20",
    walletAddress: "0x2cD8b64Fa19E307c5B0a92D8f4C61E73a5b09284",
    txHash: "0x50f9a1c73b8d06e254187ac3b0f9d62e5417380abc90d2e5f6147b0c8394ae21",
    createdAt: "2026-07-27T08:14:00.000Z",
    status: "credited",
    creditedAt: "2026-07-27T08:52:00.000Z",
  }),
  deposit({
    id: "DEP-90224",
    userId: "usr_63c8f1",
    userName: "Gaurav Sinha",
    userDisplayId: "NT-4820217",
    amountUsdt: 1800,
    network: "trc20",
    walletAddress: "TYn8dK1mV4pX7bR3jW9cL5hQ2fS6gT0aZo",
    txHash: "7ac21b90de53f8064172cb3a05d9e847f1360bc2a94e0d715830a6bf4c9d2e01",
    createdAt: "2026-07-25T17:33:00.000Z",
    status: "credited",
    creditedAt: "2026-07-25T17:59:00.000Z",
  }),
  deposit({
    id: "DEP-90223",
    userId: "usr_04ae83",
    userName: "Pooja Reddy",
    userDisplayId: "NT-4820210",
    amountUsdt: 700,
    network: "bep20",
    walletAddress: "TCr8gN3mV6kP9xB2jL5dW7hF4yS1gQ0aTu",
    txHash: "0xb3705e2c9148af6d0273cb51e08a4f93615d27ab0c94e8f3105b6a2d7ce09481",
    createdAt: "2026-07-23T11:47:00.000Z",
    status: "credited",
    creditedAt: "2026-07-23T12:05:00.000Z",
  }),
  deposit({
    id: "DEP-90222",
    userId: "usr_7f0d44",
    userName: "Ritu Malhotra",
    userDisplayId: "NT-4820214",
    amountUsdt: 1200,
    network: "trc20",
    walletAddress: "TZm1pK4vN7bR2xJ9wL6dH3cS8fY5gQ0aTe",
    txHash: "2e94c07ab135d68f0421ac93be570d8f6193b2ca047de8156a03bc7f9e2d0184",
    createdAt: "2026-07-21T09:12:00.000Z",
    status: "credited",
    creditedAt: "2026-07-21T09:38:00.000Z",
  }),
  deposit({
    id: "DEP-90221",
    userId: "usr_47e309",
    userName: "Neha Bhatt",
    userDisplayId: "NT-4820220",
    amountUsdt: 400,
    network: "trc20",
    walletAddress: "TRq2mK7nV5bP8xJ3wL1dC6hS9fY4gT0aNe",
    txHash: "8f31da06be729c45012a7bc3e850df9614730ab2c95de806137fb4a2c0e95d38",
    createdAt: "2026-07-19T14:58:00.000Z",
    status: "credited",
    creditedAt: "2026-07-19T15:21:00.000Z",
  }),
  deposit({
    id: "DEP-90220",
    userId: "usr_9e6b28",
    userName: "Vikram Singh",
    userDisplayId: "NT-4820197",
    amountUsdt: 150,
    network: "polygon",
    walletAddress: "TWq3jM6nV8kR1pS4bD7hL2xC9fY5gT0aBc",
    txHash: "0xc7031b5ea948df26107a3cb0e295f814d6027ba3c81e9d504f7b2a6c3e08d915",
    createdAt: "2026-07-15T19:26:00.000Z",
    status: "failed",
    failureReason: "Transaction dropped from the mempool before confirmation.",
  }),
];

export function getAdminDepositById(id: string): AdminDeposit | undefined {
  return adminDeposits.find((d) => d.id === id);
}

export function getDepositsForUser(userId: string): AdminDeposit[] {
  return adminDeposits.filter((d) => d.userId === userId);
}

export const depositStatusLabels: Record<AdminDepositStatus, string> = {
  pending: "Pending",
  detected: "Detected",
  confirming: "Confirming",
  confirmed: "Confirmed",
  credited: "Credited",
  failed: "Failed",
  ignored: "Ignored",
};

export const depositNetworkLabels: Record<DepositNetworkId, string> = {
  trc20: "TRC-20 · Tron",
  erc20: "ERC-20 · Ethereum",
  bep20: "BEP-20 · BNB Chain",
  polygon: "Polygon",
};
