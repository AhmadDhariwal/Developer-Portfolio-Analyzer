// Native MongoDB expression for the existing SHA-256 application key. The input
// is exactly 49 ASCII bytes: two canonical ObjectId strings separated by ':'.
// This keeps integrity filtering before counts without server-side JavaScript,
// a new persisted identity, or a full-population scan in the Node process.
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];
const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const at = (value, index) => ({ $arrayElemAt: [value, index] });
const add = (...values) => ({ $mod: [{ $add: values }, 0x100000000] });
const shift = (value, n) => ({ $floor: { $divide: [value, 2 ** n] } });
const rotate = (value, n) => ({
  $add: [shift(value, n), { $multiply: [{ $mod: [value, 2 ** n] }, 2 ** (32 - n)] }]
});
const bits = (op, ...values) => ({ [op]: values.map((value) => ({ $toLong: value })) });
const xor = (...values) => bits('$bitXor', ...values);
const and = (...values) => bits('$bitAnd', ...values);
const sigma = (value, a, b, c, small = false) =>
  xor(rotate(value, a), rotate(value, b), small ? shift(value, c) : rotate(value, c));

function applicationKeyExpression(job, applicant) {
  // Query optimizers may evaluate expressions before adjacent type predicates.
  // Convert corrupt raw tuples to empty ASCII instead of throwing or disclosing.
  const objectIdText = (value) => ({
    $cond: [{ $eq: [{ $type: value }, 'objectId'] }, { $toString: value }, '']
  });
  const input = { $concat: [objectIdText(job), ':', objectIdText(applicant)] };
  const ascii = {
    $let: {
      vars: { char: { $substrBytes: ['$$key', '$$this', 1] } },
      in: at([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 97, 98, 99, 100, 101, 102], {
        $indexOfBytes: ['0123456789:abcdef', '$$char']
      })
    }
  };
  const words = {
    $map: {
      input: { $range: [0, 16] },
      as: 'word',
      in: {
        $reduce: {
          input: {
            $range: [{ $multiply: ['$$word', 4] }, { $multiply: [{ $add: ['$$word', 1] }, 4] }]
          },
          initialValue: 0,
          in: {
            $add: [
              { $multiply: ['$$value', 256] },
              {
                $switch: {
                  branches: [
                    { case: { $lt: ['$$this', 49] }, then: ascii },
                    { case: { $eq: ['$$this', 49] }, then: 128 },
                    { case: { $eq: ['$$this', 62] }, then: 1 },
                    { case: { $eq: ['$$this', 63] }, then: 136 }
                  ],
                  default: 0
                }
              }
            ]
          }
        }
      }
    }
  };
  const previous = (offset) => at('$$value', { $subtract: ['$$this', offset] });
  const schedule = {
    $reduce: {
      input: { $range: [16, 64] },
      initialValue: words,
      in: {
        $concatArrays: [
          '$$value',
          [
            add(
              previous(16),
              sigma(previous(15), 7, 18, 3, true),
              previous(7),
              sigma(previous(2), 17, 19, 10, true)
            )
          ]
        ]
      }
    }
  };
  const state = (n) => at('$$value', n);
  const rounds = {
    $reduce: {
      input: { $range: [0, 64] },
      initialValue: INITIAL,
      in: {
        $let: {
          vars: {
            t1: add(
              state(7),
              sigma(state(4), 6, 11, 25),
              xor(and(state(4), state(5)), and(xor(state(4), 0xffffffff), state(6))),
              at(ROUND, '$$this'),
              at('$$schedule', '$$this')
            ),
            t2: add(
              sigma(state(0), 2, 13, 22),
              xor(and(state(0), state(1)), and(state(0), state(2)), and(state(1), state(2)))
            )
          },
          in: [
            add('$$t1', '$$t2'),
            state(0),
            state(1),
            state(2),
            add(state(3), '$$t1'),
            state(4),
            state(5),
            state(6)
          ]
        }
      }
    }
  };
  const hex = {
    $reduce: {
      input: { $range: [0, 8] },
      initialValue: '',
      in: {
        $let: {
          vars: { digest: add(at('$$hash', '$$this'), at(INITIAL, '$$this')) },
          in: {
            $concat: [
              '$$value',
              {
                $reduce: {
                  input: [28, 24, 20, 16, 12, 8, 4, 0],
                  initialValue: '',
                  in: {
                    $concat: [
                      '$$value',
                      {
                        $substrBytes: [
                          '0123456789abcdef',
                          {
                            $mod: [
                              { $floor: { $divide: ['$$digest', { $pow: [2, '$$this'] }] } },
                              16
                            ]
                          },
                          1
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
  return {
    $let: {
      vars: { key: input },
      in: {
        $let: { vars: { schedule }, in: { $let: { vars: { hash: rounds }, in: hex } } }
      }
    }
  };
}

module.exports = { applicationKeyExpression };
