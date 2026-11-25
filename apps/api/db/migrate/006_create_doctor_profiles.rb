Sequel.migration do
  change do
    create_table(:doctor_profiles) do
      primary_key :id
      foreign_key :user_id, :users, null: false, unique: true
      foreign_key :department_id, :departments, null: false
      String :specialty_title
      String :medical_licence_no
      String :consulting_room
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
