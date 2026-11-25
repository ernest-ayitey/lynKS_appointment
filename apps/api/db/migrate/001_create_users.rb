Sequel.migration do
  change do
    create_table(:users) do
      primary_key :id
      String :role, null: false
      String :username, null: false
      index :username, unique: true
      String :password_digest, null: false
      String :email, null: false
      String :phone
      String :first_name, null: false
      String :last_name, null: false
      Date :date_of_birth
      String :gender
      String :status, null: false, default: 'active'
      TrueClass :must_change_password, null: false, default: false
      Integer :failed_login_count, null: false, default: 0
      DateTime :locked_at
      DateTime :deactivated_at
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
