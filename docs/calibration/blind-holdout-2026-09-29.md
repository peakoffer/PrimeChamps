# Blind hold-out for in-session calibration (locked 2026-09-29)

Selection is deterministic and reproducible: within each label, order Dylan's
100 records by `md5(id || 'prime-champs-calibration-2026-09-29')` and take the
first 13 `fit` and first 17 `not_fit`. These 30 records are **not** read for
outcome, primary reason, or explanation during calibration. They are scored
blind only after the rubric, prompt, evidence policy and thresholds are frozen,
with predictions written down before labels are compared.

The remaining 70 records (31 fit, 39 not_fit) are the calibration set.

Blind fit (13):
85629497-191a-45c3-a626-df368877cb1f, e343f9f5-10f5-401e-bfde-46c9154617e1,
2b48a7b9-cd60-4b37-afaa-62e089120c87, f5b6dd3c-4fd5-4025-852e-09369df3b9ed,
9b2bd66a-68eb-4b3d-be14-c88dba3cc015, 3fe69fae-14a7-44ac-a9b0-ddf1c4b49d61,
dcf75c6c-1267-4e6f-bc5d-93d725f84316, 3d9c7bdb-bc7d-4611-b57a-fe8674b322cd,
a5dab876-2021-49ac-993f-976a33d54cdf, cb6d5000-40d1-43a6-ae65-b5d8fb5df87d,
b5087a94-8284-4b35-9d80-1930aca60cdf, 8ff846b5-d96f-4b66-844e-90186c77df59,
f77e4fba-f90d-46df-aa59-d364985e67a4

Blind not_fit (17):
eb812cfd-ecc9-4f78-a00d-d903dd7eb772, d3da2745-73dc-44a6-8e9f-162d9447c231,
7b20a35b-ea24-452d-aa81-5d4ce02edbb8, 34e7d4d7-7fac-4258-b006-4b80f6cb6e22,
7bf050a0-0e25-42c0-ba27-363349a1a33a, 4f8dc1f9-a248-47e9-add1-015dd173d1c8,
6e4fd66b-9806-4ab2-876f-6a2dde70c4fd, f31282e9-9a47-4be5-a949-132e7a177335,
3acde854-f19c-48a1-98f3-208dbb9d7b82, 3afac948-69c4-4603-87b5-90b002bd5ab6,
e055f5ce-36a6-4894-8b64-3292256e763d, 1d3ee1b1-ff56-4958-9a2e-d552c4ee44af,
b63b3077-31f9-49ce-b37c-0a07acf45ca5, 0ab8ef92-287a-4d8c-982a-6908433546ca,
1641e3c2-59cc-4257-82cc-2df63d837203, 5930037b-c944-4152-aa3f-7f9ed06125d8,
6edc9851-cab1-466d-8026-3e33b9444863
