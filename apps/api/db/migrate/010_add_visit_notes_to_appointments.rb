Sequel.migration do
  change do
    alter_table(:appointments) do
      add_column :visit_notes, String
    end
  end
end
