import type { DepositNetwork, Transaction } from "@/types";

/**
 * Mock transaction history and deposit networks.
 * INTEGRATION POINT: replace with the ledger API. Deposit addresses will be
 * issued per-user by the deposit service, not hard-coded.
 */

export const transactions: Transaction[] = [
  {
    id: "tx_2041",
    type: "reward",
    amount: 23.4,
    currency: "USDT",
    status: "completed",
    date: "2026-08-06T09:15:00.000Z",
    description: "Weekly reward · Balanced Growth",
    reference: "RW-2041",
  },
  {
    id: "tx_2040",
    type: "deposit",
    amount: 500,
    currency: "USDT",
    status: "completed",
    date: "2026-08-04T14:02:00.000Z",
    description: "Deposit received",
    reference: "0x9f2c7a41b8de05c36f1a94e7d2b8c05a7e4113f9",
    network: "trc20",
    confirmations: { current: 20, required: 20 },
  },
  {
    id: "tx_2039",
    type: "withdrawal",
    amount: -300,
    currency: "USDT",
    status: "processing",
    date: "2026-08-03T11:48:00.000Z",
    description: "Withdrawal to HDFC •••• 4821",
    reference: "WD-88214",
    inrAmount: 24714.5,
    feeUsdt: 3,
  },
  {
    id: "tx_2038",
    type: "referral",
    amount: 12.5,
    currency: "USDT",
    status: "completed",
    date: "2026-08-02T18:30:00.000Z",
    description: "Referral commission · Priya M.",
    reference: "RF-1182",
  },
  {
    id: "tx_2037",
    type: "reward",
    amount: 23.1,
    currency: "USDT",
    status: "completed",
    date: "2026-07-30T09:15:00.000Z",
    description: "Weekly reward · Balanced Growth",
    reference: "RW-2037",
  },
  {
    id: "tx_2036",
    type: "investment",
    amount: -1200,
    currency: "USDT",
    status: "completed",
    date: "2026-07-28T10:05:00.000Z",
    description: "Allocation · Momentum Plan",
    reference: "IN-1038",
  },
  {
    id: "tx_2035",
    type: "deposit",
    amount: 1500,
    currency: "USDT",
    status: "completed",
    date: "2026-07-27T16:22:00.000Z",
    description: "Deposit received",
    reference: "0x41ba7e9c25d8f03b17c6a92e4f8d10b3c7e5920a",
    network: "bep20",
    confirmations: { current: 15, required: 15 },
  },
  {
    id: "tx_2034",
    type: "deposit",
    amount: 200,
    currency: "USDT",
    status: "pending",
    date: "2026-07-26T08:11:00.000Z",
    description: "Deposit awaiting confirmations",
    reference: "0xb72e13cf98a4d605e2c17f83b9d40a6c5e2718df",
    network: "erc20",
    confirmations: { current: 4, required: 12 },
  },
  {
    id: "tx_2033",
    type: "reward",
    amount: 22.8,
    currency: "USDT",
    status: "completed",
    date: "2026-07-23T09:15:00.000Z",
    description: "Weekly reward · Balanced Growth",
    reference: "RW-2033",
  },
  {
    id: "tx_2032",
    type: "withdrawal",
    amount: -450,
    currency: "USDT",
    status: "completed",
    date: "2026-07-18T13:40:00.000Z",
    description: "Withdrawal to HDFC •••• 4821",
    reference: "WD-87903",
    inrAmount: 37113.75,
    feeUsdt: 3.75,
  },
  {
    id: "tx_2031",
    type: "referral",
    amount: 8.75,
    currency: "USDT",
    status: "completed",
    date: "2026-07-15T20:12:00.000Z",
    description: "Referral commission · Rohan K.",
    reference: "RF-1174",
  },
  {
    id: "tx_2030",
    type: "investment",
    amount: -2500,
    currency: "USDT",
    status: "completed",
    date: "2026-06-18T09:00:00.000Z",
    description: "Allocation · Balanced Growth",
    reference: "IN-1041",
  },
  {
    id: "tx_2029",
    type: "withdrawal",
    amount: -120,
    currency: "USDT",
    status: "failed",
    date: "2026-06-11T07:25:00.000Z",
    description: "Withdrawal failed · bank details rejected",
    reference: "WD-87455",
    inrAmount: 9948,
    feeUsdt: 0,
  },
  {
    id: "tx_2028",
    type: "deposit",
    amount: 3000,
    currency: "USDT",
    status: "completed",
    date: "2026-06-02T12:00:00.000Z",
    description: "Deposit received",
    reference: "0x5d18c7a03be92f14a86d5c0729be431f8ad60c95",
    network: "trc20",
    confirmations: { current: 20, required: 20 },
  },
];

export const recentTransactions = transactions.slice(0, 5);

export function getTransactionById(id: string): Transaction | undefined {
  return transactions.find((transaction) => transaction.id === id);
}

/**
 * Supported deposit networks. Addresses are placeholders for the prototype —
 * do not send funds to them.
 */
export const depositNetworks: DepositNetwork[] = [
  {
    id: "trc20",
    name: "USDT · TRC20",
    chain: "Tron",
    address: "TQ5nR8xWvKp2mYdL7fJhA3cVbN9tGsE4Uz",
    minDeposit: 10,
    estimatedArrival: "1–3 minutes",
    requiredConfirmations: 20,
    networkFeeNote: "Lowest network fee",
    recommended: true,
  },
  {
    id: "bep20",
    name: "USDT · BEP20",
    chain: "BNB Smart Chain",
    address: "0x7fA2c94BdE13a05C8f6b271Da9E4C3b8A1d05e62",
    minDeposit: 10,
    estimatedArrival: "2–5 minutes",
    requiredConfirmations: 15,
    networkFeeNote: "Low network fee",
  },
  {
    id: "polygon",
    name: "USDT · Polygon",
    chain: "Polygon PoS",
    address: "0x3Ce81b0aF9527D4e6b18Ac05f2719dCb64E830a1",
    minDeposit: 10,
    estimatedArrival: "3–8 minutes",
    requiredConfirmations: 30,
    networkFeeNote: "Low network fee",
  },
  {
    id: "erc20",
    name: "USDT · ERC20",
    chain: "Ethereum",
    address: "0xB92f47c1D605e83a2719Ac4E0f6b18d3C7a59201",
    minDeposit: 50,
    estimatedArrival: "5–15 minutes",
    requiredConfirmations: 12,
    networkFeeNote: "Higher network fee",
  },
];

export function getNetworkById(id: string): DepositNetwork | undefined {
  return depositNetworks.find((network) => network.id === id);
}
