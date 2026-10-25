// Optional fields for the dedicated payment flow, verified against the API contract.
const paymentDetailSchema = {
  'type': 'object',
  'properties': {
    'payerGuardianId': {'type': 'string', 'format': 'uuid'},
    'paidAt': {'type': 'string', 'format': 'date-time'},
    'receiptNo': {'type': 'string'},
    'bankRef': {'type': 'string'},
    'attachmentFileId': {'type': 'string', 'format': 'uuid'},
    'allocations': {
      'description': 'Omit to auto-allocate FIFO, oldest open charge first',
      'type': 'array',
      'items': {
        'type': 'object',
        'properties': {
          'chargeId': {'type': 'string', 'format': 'uuid'},
          'amountTiyin': {
            'type': 'string',
            'description': 'Integer tiyin as a string',
            'pattern': '^\\d+\$',
          },
        },
        'required': ['chargeId', 'amountTiyin'],
      },
      'minItems': 1,
    },
  },
  'required': ['paidAt'],
};
