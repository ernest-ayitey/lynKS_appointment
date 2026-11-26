Sequel.migration do
  change do
    create_table(:appointments) do
      primary_key :id
      foreign_key :patient_id, :users, null: false
      foreign_key :doctor_id, :users, null: false
      foreign_key :department_id, :departments, null: false
      Date :date, null: false
      String :time, null: false
      Integer :duration_minutes, null: false
      String :visit_type, null: false
      String :reason, null: false
      String :status, null: false, default: 'pending'
      DateTime :submitted_at, null: false
      DateTime :decided_at
      foreign_key :decided_by_user_id, :users
      String :decline_reason_code
      String :decline_message
      String :internal_note
      foreign_key :reschedule_of_id, :appointments
      TrueClass :sms_reminder_opt_in, null: false, default: false
      DateTime :created_at, null: false
      DateTime :updated_at, null: false

      index %i[doctor_id date time]
      index :patient_id
    end
  end
end
