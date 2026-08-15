import hashlib
import json
from pathlib import Path

from gltest.direct.sdk_loader import setup_sdk_paths


IMAGE_BYTES = b"not-a-real-png-but-large-enough-for-the-direct-mode-image-mock" * 3
IMAGE_HASH = hashlib.sha256(IMAGE_BYTES).hexdigest()
USER_HASH = hashlib.sha256(b"demo_explorer").hexdigest()
EVIDENCE_URL = "https://evidence.irlquest.example/api/evidence/submission-1?expires=1999999999&signature=abc"
RULES = json.dumps([
    "A real outdoor sunset is clearly visible.",
    "The horizon is present.",
])


def as_address(value):
    from genlayer.py.types import Address

    return Address(value) if isinstance(value, bytes) else value


def deploy_verifier(direct_vm, direct_deploy, owner):
    setup_sdk_paths(Path("contracts/IRLQuestVerifier.py"), "v0.2.16")
    direct_vm.sender = as_address(owner)
    return direct_deploy("contracts/IRLQuestVerifier.py", as_address(owner))


def mock_evidence(direct_vm):
    direct_vm.mock_web(
        r".*evidence\.irlquest\.example/api/evidence/.*",
        {"status": 200, "body": IMAGE_BYTES},
    )


def call_verify(contract, submission_id="submission-1"):
    return contract.verify_submission(
        submission_id,
        USER_HASH,
        "quest_golden_hour",
        "quest_golden_hour_v1",
        "Sky snap",
        "Photograph a real sunset with the horizon and warm sky clearly visible.",
        RULES,
        "Include a clear thumbs-up anywhere in the photo.",
        EVIDENCE_URL,
        IMAGE_HASH,
    )


def test_pass_result_is_stored_with_only_bounded_fields(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy_verifier(direct_vm, direct_deploy, direct_alice)
    mock_evidence(direct_vm)
    direct_vm.mock_llm(
        r".*verifying one live IRLQuest photo submission.*",
        json.dumps({
            "quest_satisfied": True,
            "challenge_satisfied": True,
            "evidence_clear": True,
            "safe": True,
        }),
    )

    result = call_verify(contract)

    assert result["verdict"] == "PASS"
    assert result["reason_code"] == "PASS"
    assert result["summary"] == "Proof accepted."
    assert contract.get_policy()["policy_version"] == "irlquest.photo-proof.v2"
    assert result["evidence_sha256"] == IMAGE_HASH
    assert "evidence_url" not in result
    assert contract.get_result("submission-1") == result
    assert contract.get_result_count() == 1


def test_failed_live_challenge_is_rejected(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy_verifier(direct_vm, direct_deploy, direct_alice)
    mock_evidence(direct_vm)
    direct_vm.mock_llm(
        r".*verifying one live IRLQuest photo submission.*",
        json.dumps({
            "quest_satisfied": True,
            "challenge_satisfied": False,
            "evidence_clear": True,
            "safe": True,
        }),
    )

    result = call_verify(contract)

    assert result["verdict"] == "FAIL"
    assert result["reason_code"] == "CHALLENGE_NOT_MET"
    assert result["evidence_clear"] is True
    assert result["summary"] == "The live gesture wasn't visible."


def test_prompt_defines_missing_requirements_as_failures_not_unclear():
    source = Path("contracts/IRLQuestVerifier.py").read_text(encoding="utf-8")

    assert "quest_satisfied checks only the QUEST and VERIFICATION RULES" in source
    assert "challenge_satisfied checks only the LIVE ANTI-REPLAY CHALLENGE" in source
    assert "keep evidence_clear=true" in source


def test_only_relayer_can_request_verification(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_verifier(direct_vm, direct_deploy, direct_alice)
    direct_vm.sender = direct_bob

    with direct_vm.expect_revert("Only the configured IRLQuest relayer"):
        call_verify(contract)


def test_submission_id_cannot_be_replayed(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy_verifier(direct_vm, direct_deploy, direct_alice)
    mock_evidence(direct_vm)
    direct_vm.mock_llm(
        r".*verifying one live IRLQuest photo submission.*",
        json.dumps({
            "quest_satisfied": True,
            "challenge_satisfied": True,
            "evidence_clear": True,
            "safe": True,
        }),
    )
    call_verify(contract)

    with direct_vm.expect_revert("already been verified"):
        call_verify(contract)


def test_evidence_hash_must_match(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy_verifier(direct_vm, direct_deploy, direct_alice)
    mock_evidence(direct_vm)

    with direct_vm.expect_revert("Evidence hash does not match"):
        contract.verify_submission(
            "submission-bad-hash",
            USER_HASH,
            "quest_golden_hour",
            "quest_golden_hour_v1",
            "Sky snap",
            "Photograph a real sunset with the horizon and warm sky clearly visible.",
            RULES,
            "Include a clear thumbs-up anywhere in the photo.",
            EVIDENCE_URL,
            "0" * 64,
        )
