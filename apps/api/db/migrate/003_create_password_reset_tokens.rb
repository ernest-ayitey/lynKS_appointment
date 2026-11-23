Sequel.migration do
  change do
    create_table(:password_reset_tokens) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      String :token, null: false
      index :token, unique: true
      DateTime :expires_at, null: false
      DateTime :used_at
      DateTime :created_at, null: false
    end
  end
end
