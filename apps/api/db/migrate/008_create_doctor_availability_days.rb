Sequel.migration do
  change do
    create_table(:doctor_availability_days) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      Date :date, null: false
      TrueClass :is_available, null: false, default: true
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
      index %i[user_id date], unique: true
    end
  end
end
