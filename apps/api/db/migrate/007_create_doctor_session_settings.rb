Sequel.migration do
  change do
    create_table(:doctor_session_settings) do
      primary_key :id
      foreign_key :user_id, :users, null: false, unique: true
      String :start_time, null: false, default: '09:00'
      String :end_time, null: false, default: '17:00'
      Integer :slot_length_minutes, null: false, default: 20
      Integer :max_patients_per_day
      String :break_start
      String :break_end
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
