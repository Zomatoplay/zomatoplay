import type { KycReviewStatus, KycSubmission } from "@/types/admin";

/**
 * Mock KYC review queue.
 *
 * No verification provider is connected. Documents are references only — the
 * prototype renders a document tile rather than a file preview.
 *
 * INTEGRATION POINT: replace with the provider's case list. `riskFlags` stands
 * in for the automated signals a provider returns; `status` would be driven by
 * their webhook rather than by the reducer in `@/lib/admin-store`.
 */

export const kycSubmissions: KycSubmission[] = [
  {
    id: "kyc_1042",
    userId: "usr_d5107a",
    userName: "Ishita Banerjee",
    userDisplayId: "NT-4820202",
    submittedAt: "2026-08-09T06:24:00.000Z",
    status: "pending",
    details: {
      legalName: "Ishita Banerjee",
      dateOfBirth: "1994-03-18",
      nationality: "Indian",
      address: "22 Salt Lake Sector V, Kolkata, West Bengal 700091",
      documentType: "passport",
      documentNumberMasked: "S••••••42",
    },
    documents: [
      {
        id: "doc_1",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-09T06:22:00.000Z",
        pages: 1,
      },
      {
        id: "doc_2",
        label: "Liveness capture",
        type: "passport",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-09T06:24:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1041",
    userId: "usr_b8a615",
    userName: "Anjali Dubey",
    userDisplayId: "NT-4820222",
    submittedAt: "2026-08-08T15:10:00.000Z",
    status: "under_review",
    details: {
      legalName: "Anjali Dubey",
      dateOfBirth: "1991-11-02",
      nationality: "Indian",
      address: "8 Civil Lines, Kanpur, Uttar Pradesh 208001",
      documentType: "national_id",
      documentNumberMasked: "••••  ••••  7734",
    },
    documents: [
      {
        id: "doc_3",
        label: "National ID — front",
        type: "national_id",
        fileName: "id_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T15:06:00.000Z",
        pages: 1,
      },
      {
        id: "doc_4",
        label: "National ID — back",
        type: "national_id",
        fileName: "id_back.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T15:07:00.000Z",
        pages: 1,
      },
      {
        id: "doc_5",
        label: "Liveness capture",
        type: "national_id",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T15:10:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Divya Nambiar",
    reviewedAt: null,
    rejectionReason: null,
    notes: [
      {
        id: "note_1",
        author: "Divya Nambiar",
        body: "Address on the ID does not match the declared address. Requested clarification from the user before deciding.",
        createdAt: "2026-08-08T16:02:00.000Z",
      },
    ],
    riskFlags: ["Address mismatch"],
  },
  {
    id: "kyc_1040",
    userId: "usr_86ba07",
    userName: "Tanvi Shah",
    userDisplayId: "NT-4820208",
    submittedAt: "2026-08-07T11:48:00.000Z",
    status: "pending",
    details: {
      legalName: "Tanvi Rajesh Shah",
      dateOfBirth: "1997-06-25",
      nationality: "Indian",
      address: "114 Navrangpura, Ahmedabad, Gujarat 380009",
      documentType: "driving_licence",
      documentNumberMasked: "GJ••••••2210",
    },
    documents: [
      {
        id: "doc_6",
        label: "Driving licence — front",
        type: "driving_licence",
        fileName: "licence_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-07T11:45:00.000Z",
        pages: 1,
      },
      {
        id: "doc_7",
        label: "Liveness capture",
        type: "driving_licence",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-07T11:48:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    notes: [],
    riskFlags: ["Name differs from account name"],
  },
  {
    id: "kyc_1039",
    userId: "usr_71ac03",
    userName: "Rohan Kulkarni",
    userDisplayId: "NT-4820195",
    submittedAt: "2026-08-06T09:32:00.000Z",
    status: "pending",
    details: {
      legalName: "Rohan Kulkarni",
      dateOfBirth: "1989-01-30",
      nationality: "Indian",
      address: "45 Kothrud, Pune, Maharashtra 411038",
      documentType: "passport",
      documentNumberMasked: "P••••••18",
    },
    documents: [
      {
        id: "doc_8",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-06T09:28:00.000Z",
        pages: 1,
      },
      {
        id: "doc_9",
        label: "Liveness capture",
        type: "passport",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-06T09:32:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: false,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    notes: [],
    riskFlags: ["Liveness check inconclusive"],
  },
  {
    id: "kyc_1038",
    userId: "usr_31e7b0",
    userName: "Yash Chauhan",
    userDisplayId: "NT-4820213",
    submittedAt: "2026-08-07T20:05:00.000Z",
    status: "resubmission_requested",
    details: {
      legalName: "Yash Chauhan",
      dateOfBirth: "1999-09-12",
      nationality: "Indian",
      address: "6 Vasant Kunj, New Delhi 110070",
      documentType: "national_id",
      documentNumberMasked: "••••  ••••  1908",
    },
    documents: [
      {
        id: "doc_10",
        label: "National ID — front",
        type: "national_id",
        fileName: "id_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-07T20:01:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: false,
    reviewedBy: "Divya Nambiar",
    reviewedAt: "2026-08-08T08:14:00.000Z",
    rejectionReason: null,
    notes: [
      {
        id: "note_2",
        author: "Divya Nambiar",
        body: "Only the front of the ID was uploaded and the liveness step was not completed. Asked the user to resubmit both.",
        createdAt: "2026-08-08T08:14:00.000Z",
      },
    ],
    riskFlags: ["Incomplete submission"],
  },
  {
    id: "kyc_1037",
    userId: "usr_c40917",
    userName: "Karan Joshi",
    userDisplayId: "NT-4820199",
    submittedAt: "2026-05-30T13:20:00.000Z",
    status: "rejected",
    details: {
      legalName: "Karan Joshi",
      dateOfBirth: "1993-04-08",
      nationality: "Indian",
      address: "77 Indiranagar, Bengaluru, Karnataka 560038",
      documentType: "national_id",
      documentNumberMasked: "••••  ••••  5510",
    },
    documents: [
      {
        id: "doc_11",
        label: "National ID — front",
        type: "national_id",
        fileName: "id_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-05-30T13:17:00.000Z",
        pages: 1,
      },
      {
        id: "doc_12",
        label: "National ID — back",
        type: "national_id",
        fileName: "id_back.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-05-30T13:18:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: false,
    reviewedBy: "Divya Nambiar",
    reviewedAt: "2026-06-02T10:05:00.000Z",
    rejectionReason:
      "Document details did not match the declared identity on two consecutive submissions.",
    notes: [
      {
        id: "note_3",
        author: "Divya Nambiar",
        body: "Second submission shows the same mismatch as the first. Escalated to compliance and account blocked pending review.",
        createdAt: "2026-06-02T10:06:00.000Z",
      },
    ],
    riskFlags: ["Document mismatch", "Repeat rejection"],
  },
  {
    id: "kyc_1036",
    userId: "usr_9042ba",
    userName: "Imran Sheikh",
    userDisplayId: "NT-4820219",
    submittedAt: "2026-02-14T10:44:00.000Z",
    status: "rejected",
    details: {
      legalName: "Imran Sheikh",
      dateOfBirth: "1986-12-19",
      nationality: "Indian",
      address: "31 Hazratganj, Lucknow, Uttar Pradesh 226001",
      documentType: "passport",
      documentNumberMasked: "M••••••07",
    },
    documents: [
      {
        id: "doc_13",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-02-14T10:41:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Rohit Malviya",
    reviewedAt: "2026-02-21T09:30:00.000Z",
    rejectionReason: "Identity document expired before the submission date.",
    notes: [
      {
        id: "note_4",
        author: "Rohit Malviya",
        body: "Passport expired Nov 2025. Resubmission with a current document requested; no response since.",
        createdAt: "2026-02-21T09:31:00.000Z",
      },
    ],
    riskFlags: ["Expired document"],
  },
  {
    id: "kyc_1035",
    userId: "usr_2f90bd",
    userName: "Priya Menon",
    userDisplayId: "NT-4820194",
    submittedAt: "2026-07-29T08:12:00.000Z",
    status: "approved",
    details: {
      legalName: "Priya Menon",
      dateOfBirth: "1995-07-04",
      nationality: "Indian",
      address: "9 Anna Nagar, Chennai, Tamil Nadu 600040",
      documentType: "passport",
      documentNumberMasked: "R••••••63",
    },
    documents: [
      {
        id: "doc_14",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-07-29T08:09:00.000Z",
        pages: 1,
      },
      {
        id: "doc_15",
        label: "Liveness capture",
        type: "passport",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-07-29T08:12:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Divya Nambiar",
    reviewedAt: "2026-07-29T14:38:00.000Z",
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1034",
    userId: "usr_770b41",
    userName: "Kavya Iyer",
    userDisplayId: "NT-4820206",
    submittedAt: "2026-08-08T12:40:00.000Z",
    status: "pending",
    details: {
      legalName: "Kavya Iyer",
      dateOfBirth: "1998-02-27",
      nationality: "Indian",
      address: "18 Jayanagar, Bengaluru, Karnataka 560041",
      documentType: "national_id",
      documentNumberMasked: "••••  ••••  9041",
    },
    documents: [
      {
        id: "doc_16",
        label: "National ID — front",
        type: "national_id",
        fileName: "id_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T12:36:00.000Z",
        pages: 1,
      },
      {
        id: "doc_17",
        label: "National ID — back",
        type: "national_id",
        fileName: "id_back.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T12:37:00.000Z",
        pages: 1,
      },
      {
        id: "doc_18",
        label: "Liveness capture",
        type: "national_id",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-08-08T12:40:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1033",
    userId: "usr_5db417",
    userName: "Sneha Desai",
    userDisplayId: "NT-4820196",
    submittedAt: "2026-07-01T09:02:00.000Z",
    status: "approved",
    details: {
      legalName: "Sneha Desai",
      dateOfBirth: "1992-10-15",
      nationality: "Indian",
      address: "204 Bandra West, Mumbai, Maharashtra 400050",
      documentType: "driving_licence",
      documentNumberMasked: "MH••••••8830",
    },
    documents: [
      {
        id: "doc_19",
        label: "Driving licence — front",
        type: "driving_licence",
        fileName: "licence_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-07-01T08:58:00.000Z",
        pages: 1,
      },
      {
        id: "doc_20",
        label: "Liveness capture",
        type: "driving_licence",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-07-01T09:02:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Rohit Malviya",
    reviewedAt: "2026-07-01T15:20:00.000Z",
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1032",
    userId: "usr_3a72fc",
    userName: "Ananya Rao",
    userDisplayId: "NT-4820198",
    submittedAt: "2026-05-30T11:15:00.000Z",
    status: "approved",
    details: {
      legalName: "Ananya Rao",
      dateOfBirth: "1990-05-21",
      nationality: "Indian",
      address: "56 Banjara Hills, Hyderabad, Telangana 500034",
      documentType: "passport",
      documentNumberMasked: "K••••••29",
    },
    documents: [
      {
        id: "doc_21",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-05-30T11:12:00.000Z",
        pages: 1,
      },
      {
        id: "doc_22",
        label: "Proof of address",
        type: "passport",
        fileName: "utility_bill.pdf",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-05-30T11:14:00.000Z",
        pages: 2,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Divya Nambiar",
    reviewedAt: "2026-05-31T10:00:00.000Z",
    rejectionReason: null,
    notes: [
      {
        id: "note_5",
        author: "Divya Nambiar",
        body: "Enhanced verification completed for large-ticket allocations. Proof of address on file.",
        createdAt: "2026-05-31T10:01:00.000Z",
      },
    ],
    riskFlags: [],
  },
  {
    id: "kyc_1031",
    userId: "usr_e93028",
    userName: "Aditya Nair",
    userDisplayId: "NT-4820205",
    submittedAt: "2026-01-26T14:50:00.000Z",
    status: "approved",
    details: {
      legalName: "Aditya Nair",
      dateOfBirth: "1987-08-09",
      nationality: "Indian",
      address: "12 Marine Drive, Kochi, Kerala 682031",
      documentType: "passport",
      documentNumberMasked: "N••••••55",
    },
    documents: [
      {
        id: "doc_23",
        label: "Passport — photo page",
        type: "passport",
        fileName: "passport_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-01-26T14:46:00.000Z",
        pages: 1,
      },
      {
        id: "doc_24",
        label: "Proof of address",
        type: "passport",
        fileName: "bank_statement.pdf",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-01-26T14:49:00.000Z",
        pages: 3,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Rohit Malviya",
    reviewedAt: "2026-01-27T09:12:00.000Z",
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1030",
    userId: "usr_4c8930",
    userName: "Devansh Gupta",
    userDisplayId: "NT-4820203",
    submittedAt: "2026-03-10T07:33:00.000Z",
    status: "approved",
    details: {
      legalName: "Devansh Gupta",
      dateOfBirth: "1991-02-14",
      nationality: "Indian",
      address: "88 Gomti Nagar, Lucknow, Uttar Pradesh 226010",
      documentType: "national_id",
      documentNumberMasked: "••••  ••••  4120",
    },
    documents: [
      {
        id: "doc_25",
        label: "National ID — front",
        type: "national_id",
        fileName: "id_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-03-10T07:29:00.000Z",
        pages: 1,
      },
      {
        id: "doc_26",
        label: "National ID — back",
        type: "national_id",
        fileName: "id_back.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-03-10T07:30:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Divya Nambiar",
    reviewedAt: "2026-03-10T13:44:00.000Z",
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
  {
    id: "kyc_1029",
    userId: "usr_59d1ca",
    userName: "Lakshmi Krishnan",
    userDisplayId: "NT-4820212",
    submittedAt: "2026-03-28T16:20:00.000Z",
    status: "approved",
    details: {
      legalName: "Lakshmi Krishnan",
      dateOfBirth: "1988-06-30",
      nationality: "Indian",
      address: "27 T Nagar, Chennai, Tamil Nadu 600017",
      documentType: "driving_licence",
      documentNumberMasked: "TN••••••4407",
    },
    documents: [
      {
        id: "doc_27",
        label: "Driving licence — front",
        type: "driving_licence",
        fileName: "licence_front.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-03-28T16:17:00.000Z",
        pages: 1,
      },
      {
        id: "doc_28",
        label: "Liveness capture",
        type: "driving_licence",
        fileName: "liveness_frame.jpg",
        // Fixture rows predate storage — there is no object to open.
        hasFile: false,
        uploadedAt: "2026-03-28T16:20:00.000Z",
        pages: 1,
      },
    ],
    livenessCheckPassed: true,
    reviewedBy: "Rohit Malviya",
    reviewedAt: "2026-03-29T08:55:00.000Z",
    rejectionReason: null,
    notes: [],
    riskFlags: [],
  },
];

/** Reasons offered when rejecting — kept as data so they stay consistent. */
export const kycRejectionReasons = [
  "Document is expired or not currently valid.",
  "Document image is unreadable or partially obscured.",
  "Details on the document do not match the declared identity.",
  "Liveness check failed or could not be matched to the document.",
  "Suspected duplicate or previously rejected account.",
  "Document type is not accepted for this jurisdiction.",
];

export function getKycSubmissionById(id: string): KycSubmission | undefined {
  return kycSubmissions.find((s) => s.id === id);
}

export function getKycSubmissionsForUser(userId: string): KycSubmission[] {
  return kycSubmissions.filter((s) => s.userId === userId);
}

export const kycStatusLabels: Record<KycReviewStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  resubmission_requested: "Resubmission requested",
};
