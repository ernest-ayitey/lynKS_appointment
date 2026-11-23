Sequel.migration do
  change do
    create_table(:refresh_tokens) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      String :token_hash, null: false
      index :token_hash, unique: true
      DateTime :expires_at, null: false
      TrueClass :remember_me, null: false, default: false
      DateTime :revoked_at
      DateTime :created_at, null: false
    end
  end
end
