Sequel.migration do
  up do
    # Reset tokens are single-use and live 30 minutes, so there is nothing
    # worth preserving here — and the stored plaintext couldn't be turned
    # into anything the new digest column would match anyway. Clearing the
    # table also makes sure no plaintext value survives the migration.
    self[:password_reset_tokens].delete

    alter_table(:password_reset_tokens) do
      rename_column :token, :token_digest
    end
  end

  down do
    self[:password_reset_tokens].delete

    alter_table(:password_reset_tokens) do
      rename_column :token_digest, :token
    end
  end
end
