//! Test-only attacker program. It forwards its instruction data to the program passed as the first
//! account, so the test suite can prove UPROAR rejects every call that arrives by CPI.
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

anchor_lang::solana_program::entrypoint!(process);

fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts
        .split_first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let metas = rest
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();
    invoke(
        &Instruction {
            program_id: *target.key,
            accounts: metas,
            data: data.to_vec(),
        },
        rest,
    )
}
