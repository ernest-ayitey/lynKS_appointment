Sequel.migration do
  change do
    create_table(:appointment_emails) do
      primary_key :id
      foreign_key :appointment_id, :appointments, null: false
      String :recipient_email, null: false
      String :subject, null: false
      DateTime :sent_at, null: false
      index :appointment_id
    end
  end
end
