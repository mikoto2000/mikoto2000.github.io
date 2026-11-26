"""Produce a numeric CSV slightly larger than 1 GiB and exact expectations."""
from pathlib import Path
import json
import math

HERE = Path(__file__).resolve().parent
out = HERE / 'fixtures'
out.mkdir(exist_ok=True)
target = out / 'numeric-1gib.csv'
header = b'c1,c2,c3,c4,c5,c6,c7,c8\n'
block_rows = 100_000
count = math.ceil((1024**3 - len(header)) / 80)
full, remainder = divmod(count, block_rows)

def values(i):
    return [100_000_000 + i, 200_000_000 + i % 100, 300_000_000 + i % 1000,
            400_000_000 + i, 500_000_000 + i, 600_000_000 + i, 700_000_000 + i, 800_000_000 + i]

block = ''.join(','.join(map(str, values(i))) + '\n' for i in range(block_rows)).encode()
assert len(block) == block_rows * 80
with target.open('wb') as file:
    file.write(header)
    for _ in range(full):
        file.write(block)
    file.write(block[:remainder * 80])

expected = {
    'file': target.name, 'bytes': target.stat().st_size, 'rows': count,
    'sum_c1': full * sum(values(i)[0] for i in range(block_rows)) + sum(values(i)[0] for i in range(remainder)),
    'sum_c8': full * sum(values(i)[7] for i in range(block_rows)) + sum(values(i)[7] for i in range(remainder)),
    'min_c1': 100_000_000, 'max_c1': 100_099_999,
    'filtered_rows': full * 1000 + sum(i % 100 == 0 for i in range(remainder)),
    'group_zero_sum': full * sum(values(i)[0] for i in range(0, block_rows, 100)) + sum(values(i)[0] for i in range(0, remainder, 100)),
}
# Keep the oracle exact when a JS test reads totals beyond Number.MAX_SAFE_INTEGER.
for column in ['sum_c1', 'sum_c8', 'group_zero_sum']:
    expected[column] = str(expected[column])
(out / 'expected.json').write_text(json.dumps(expected, indent=2) + '\n')
print(json.dumps(expected))
